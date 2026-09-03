/**
 * Scheduled Message Service
 *
 * Persists outbound messages for future delivery and dispatches them when due.
 * Dispatch reuses the canonical send pipeline: a pending `messages` row plus a
 * command outbox entry are committed in the same transaction that marks the
 * scheduled row sent, so a crash or a concurrent replica can never double-send.
 */

import type { ScheduledMessagesTable } from "@wateaminbox/database";
import { db } from "@wateaminbox/database";
import type {
  BulkRecipientSkipReason,
  ScheduledMessage,
  ScheduledMessageStatus,
} from "@wateaminbox/shared";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely, Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import { bulkConfig } from "../config/bulk.config.js";
import { NoActiveCaseError } from "../lib/errors.js";
import { createLogger, formatError } from "../lib/logger.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../lib/nats/index.js";
import { broadcastToCompany } from "../lib/realtime.js";
import {
  deleteMedia,
  getMediaObjectReference,
  resolveMediaKeyForCompany,
} from "../lib/storage.js";
import {
  finalizeBulkJobIfComplete,
  markBulkJobRunning,
} from "./bulk-job.service.js";
import {
  broadcastNewMessageToViewers,
  broadcastToContactViewers,
} from "./message-broadcast.service.js";
import { enqueueCommand } from "./command-outbox.service.js";
import { resolveActiveCaseIdForContact } from "./conversation-case.service.js";
import {
  ContactAssignedToOtherError,
  ContactBlockedError,
  requireSendAccess,
} from "./send-access.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";
import { getUserAvatarSources, getUserNames } from "./user.service.js";
import { getActiveSessionId } from "./whatsapp/session.js";

const logger = createLogger("ScheduledMessages");
const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 10;
const CLAIM_LEASE_MS = 60_000;
/** Max connections that get a bulk send per company per poll cycle. */
const BULK_CONNECTIONS_PER_CYCLE = 20;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;
let lastPollAt: Date | null = null;
let dispatchedTotal = 0;
let failedTotal = 0;
let bulkDispatchedTotal = 0;
let bulkSkippedTotal = 0;
let bulkFailedTotal = 0;

export function getScheduledMessageHealth() {
  return {
    initialized: timer !== null || running,
    running,
    stopping,
    lastPollAt,
    dispatchedTotal,
    failedTotal,
    bulkDispatchedTotal,
    bulkSkippedTotal,
    bulkFailedTotal,
  };
}

export type ScheduledMessageRow = Selectable<ScheduledMessagesTable>;

export function formatScheduledMessage(
  row: ScheduledMessageRow,
  createdByName?: string,
  authorizedMediaUrl: string | null = row.media_url,
): ScheduledMessage {
  return {
    id: row.id,
    contactId: row.contact_id,
    content: row.content,
    messageType: row.message_type,
    mediaUrl: authorizedMediaUrl,
    mediaMimeType: row.media_mime_type,
    mediaFileName: row.media_file_name,
    replyToMessageId: row.reply_to_message_id,
    scheduledAt: row.scheduled_at.toISOString(),
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    sentMessageId: row.sent_message_id,
    createdBy: row.created_by,
    createdByName,
    canceledAt: row.canceled_at ? row.canceled_at.toISOString() : null,
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    bulkJobId: row.bulk_job_id,
    skipReason: row.skip_reason,
  };
}

export function getScheduleRetryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts, 5));
}

async function broadcastScheduledUpdate(
  companyId: string,
  scheduledMessageId: string,
  contactId: string,
  status: ScheduledMessageStatus,
): Promise<void> {
  await broadcastToContactViewers(
    companyId,
    contactId,
    "scheduled_message:updated",
    { scheduledMessageId, conversationId: contactId, status },
  );
}

/** A dispatch failure that retrying can never fix (e.g. deleted contact). */
class PermanentDispatchError extends Error {}

/**
 * A bulk leaf whose recipient became ineligible after the snapshot (deleted
 * contact, block, connection moved off the job's target). Recorded as a
 * "skipped" outcome, not a failure: nothing is wrong with the system.
 */
class BulkSkipError extends Error {
  constructor(public readonly reason: BulkRecipientSkipReason) {
    super(`Recipient is no longer eligible: ${reason}`);
  }
}

/** S3 HEAD on a deleted/never-existed object. */
function isMediaMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  return error.name === "NotFound" || status === 404;
}

/**
 * Best-effort removal of a scheduled message's media object once the row can
 * never dispatch (canceled, or permanently failed). Nothing else cleans the
 * media bucket, so discarded schedules would otherwise leak objects forever.
 * The object is kept if any sent message references the same URL — dispatch
 * copies media_url verbatim into messages, so equality is exact.
 */
export async function cleanupScheduledMediaObject(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  scheduledMessageId: string,
  mediaUrl: string | null,
): Promise<void> {
  if (!mediaUrl) return;
  try {
    const referencedByMessage = await tenantDb
      .selectFrom("messages")
      .select("id")
      .where("media_url", "=", mediaUrl)
      .limit(1)
      .executeTakeFirst();
    if (referencedByMessage) return;
    await deleteMedia(resolveMediaKeyForCompany(mediaUrl, companyId));
  } catch (error) {
    logger.warn(
      { companyId, scheduledMessageId, err: formatError(error) },
      "Failed to clean up scheduled message media object",
    );
  }
}

interface DispatchSuccess {
  messageId: string;
  formattedMessage: Record<string, unknown>;
  connectionId: string;
}

/**
 * Send one claimed scheduled message through the regular pipeline. Mirrors the
 * POST /api/messages handler: resolve the contact's owning connection, build
 * the worker command, then commit the pending message + outbox entry + status
 * flip atomically.
 */
async function sendScheduledMessage(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  row: ScheduledMessageRow,
  claimToken: Date,
): Promise<DispatchSuccess> {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id", "is_blocked"])
    .where("id", "=", row.contact_id)
    .executeTakeFirst();

  if (row.bulk_job_id) {
    // Revalidate mutable eligibility for bulk recipients: the snapshot was
    // taken at job creation and any of these may have changed since.
    if (!contact) throw new BulkSkipError("contact_missing");
    if (!contact.jid) throw new BulkSkipError("no_jid");
    if (contact.is_blocked) throw new BulkSkipError("blocked");
    const job = await tenantDb
      .selectFrom("bulk_jobs")
      .select(["audience"])
      .where("id", "=", row.bulk_job_id)
      .executeTakeFirst();
    const targetConnectionId = job?.audience?.connectionId;
    if (
      targetConnectionId &&
      contact.whatsapp_connection_id !== targetConnectionId
    ) {
      // The contact moved off the connection this job explicitly targeted;
      // never silently reroute through a different account.
      throw new BulkSkipError("connection_changed");
    }
  }

  if (!contact || !contact.jid) {
    throw new PermanentDispatchError("Contact no longer exists");
  }

  const connection = contact.whatsapp_connection_id
    ? await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "jid"])
        .where("id", "=", contact.whatsapp_connection_id)
        .where("status", "=", "connected")
        .executeTakeFirst()
    : null;

  if (!connection) {
    throw new Error("The contact's WhatsApp connection is not active");
  }

  // Resolve the quoted message at dispatch time; it may have been deleted
  // since scheduling, in which case the message sends without a quote.
  let quotedWaMessageId: string | undefined;
  let quotedSenderJid: string | undefined;
  if (row.reply_to_message_id) {
    const quotedMessage = await tenantDb
      .selectFrom("messages")
      .select(["message_id", "sender_jid", "from_me"])
      .where("id", "=", row.reply_to_message_id)
      .where("contact_id", "=", row.contact_id)
      .where("whatsapp_connection_id", "=", connection.id)
      .executeTakeFirst();
    quotedWaMessageId = quotedMessage?.message_id || undefined;
    if (quotedMessage?.from_me) {
      quotedSenderJid = connection.jid || undefined;
    } else if (quotedMessage) {
      quotedSenderJid = quotedMessage.sender_jid || contact.jid;
    }
  }

  // Verify the media object still exists before building the command: a
  // vanished object can never dispatch (permanent), while any other storage
  // error stays retryable.
  if (row.media_url) {
    try {
      await getMediaObjectReference(row.media_url, companyId);
    } catch (error) {
      if (isMediaMissingError(error)) {
        throw new PermanentDispatchError(
          "The media attachment no longer exists",
        );
      }
      throw error;
    }
  }

  const messageId = crypto.randomUUID();
  const waMessageId = `pending_${messageId}`;
  const createdAt = toDbDate();
  const sessionId = await getActiveSessionId(tenantDb, connection.id);

  const sendCommand = await buildSendMessageCommand(
    companyId,
    sessionId,
    contact.jid,
    row.content,
    row.message_type,
    row.created_by,
    waMessageId,
    row.media_url || undefined,
    quotedWaMessageId,
    quotedSenderJid,
  );

  await tenantDb.transaction().execute(async (trx) => {
    // Bulk/broadcast rows intentionally bypass both checks: a bulk job has
    // no single "assignee" concept (it's a company-wide broadcast, not one
    // agent's conversation) and its recipients' lifecycle state is
    // deliberately not gated the way a normal 1:1 schedule is - see the
    // BulkSkipError revalidation above for what bulk rows DO still
    // re-check (contact/connection eligibility).
    //
    // Non-bulk rows re-run the SAME assignment/lifecycle access check a
    // live interactive send would, using `row.created_by` as the acting
    // user: the conversation was explicitly authored and queued while
    // there was an active case owned by that user, but a takeover or a
    // resolve can happen at any point before the scheduled time arrives.
    // Dispatching anyway would let an old assignee's queued message land
    // after someone else has taken over, or resurrect a resolved
    // conversation's SLA clock without ever going through Open/Reopen.
    // `claimUnassigned: false` - dispatch must never itself claim an
    // unassigned contact as a side effect; an unassigned contact is simply
    // allowed to dispatch as long as an active case exists (requireSendAccess
    // still enforces the lifecycle check either way - it only skips the
    // assignment claim, not the active-case requirement).
    let caseId: string | null;
    if (row.bulk_job_id) {
      caseId = await resolveActiveCaseIdForContact(trx, row.contact_id);
    } else {
      try {
        const access = await requireSendAccess(
          trx,
          row.contact_id,
          row.created_by,
          { claimUnassigned: false },
        );
        caseId = access.caseId;
      } catch (error) {
        if (
          error instanceof ContactAssignedToOtherError ||
          error instanceof NoActiveCaseError ||
          error instanceof ContactBlockedError
        ) {
          // None of these conditions resolve themselves on retry - the
          // assignee, the missing active case, and the block all need an
          // explicit human action (takeover, reopen, unblock) that a
          // dispatch retry can't perform.
          throw new PermanentDispatchError(error.message);
        }
        throw error;
      }
    }
    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        whatsapp_connection_id: connection.id,
        contact_id: row.contact_id,
        message_id: waMessageId,
        from_me: true,
        sender_jid: connection.jid,
        message_type: row.message_type,
        content: row.content,
        media_url: row.media_url,
        media_mime_type: row.media_mime_type,
        // The scheduled row kept the filename the operator uploaded; carry it
        // onto the sent message so its download is named like any other.
        metadata: row.media_file_name
          ? { fileName: row.media_file_name }
          : null,
        quoted_message_id: quotedWaMessageId || null,
        sent_by_user_id: row.created_by,
        status: "pending",
        timestamp: createdAt,
        created_at: createdAt,
        case_id: caseId,
      })
      .execute();
    await enqueueCommand(
      trx,
      buildCommandSubject(companyId, sessionId),
      sendCommand,
    );
    const updated = await markDispatched(trx, row, messageId, claimToken);
    if (!updated) {
      // The row left "processing" underneath us (e.g. canceled); rolling back
      // the transaction discards the message and command.
      throw new PermanentDispatchError(
        "Scheduled message is no longer claimed",
      );
    }
  });

  const [names, avatars] = await Promise.all([
    getUserNames([row.created_by]),
    getUserAvatarSources([row.created_by]),
  ]);
  const formattedMessage = {
    id: messageId,
    messageId: waMessageId,
    whatsappMessageId: waMessageId,
    conversationId: row.contact_id,
    contactId: row.contact_id,
    senderId: row.created_by,
    senderType: "user" as const,
    sentByUserId: row.created_by,
    sentByUserName: names.get(row.created_by) || row.created_by,
    sentByUserAvatarUrl: avatars.get(row.created_by)?.avatarUrl,
    sentByUserGravatarUrl: avatars.get(row.created_by)?.gravatarUrl,
    messageType: row.message_type,
    content: row.content,
    // Realtime is company-wide; authorized message reads mint media URLs.
    metadata: row.media_url ? { mediaAvailable: true } : undefined,
    replyToMessageId: row.reply_to_message_id || undefined,
    status: "pending" as const,
    createdAt,
    updatedAt: createdAt,
  };

  return { messageId, formattedMessage, connectionId: connection.id };
}

async function markDispatched(
  trx: Transaction<TenantDatabase>,
  row: ScheduledMessageRow,
  messageId: string,
  claimToken: Date,
): Promise<boolean> {
  // next_attempt_at doubles as a fencing token: it holds this claimer's lease
  // timestamp, so a claimer that stalled past its lease and was superseded by
  // another replica can no longer mark the row (or send — the tx rolls back).
  const result = await trx
    .updateTable("scheduled_messages")
    .set({
      status: "sent",
      sent_message_id: messageId,
      sent_at: toDbDate(),
      attempts: row.attempts + 1,
      last_error: null,
      updated_at: toDbDate(),
    })
    .where("id", "=", row.id)
    .where("status", "=", "processing")
    .where("next_attempt_at", "=", claimToken)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

async function recordDispatchFailure(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  row: ScheduledMessageRow,
  claimToken: Date,
  error: unknown,
): Promise<boolean> {
  const attempts = row.attempts + 1;
  const permanent = error instanceof PermanentDispatchError;
  const exhausted = permanent || attempts >= MAX_ATTEMPTS;
  const message =
    error instanceof Error ? error.message.slice(0, 2_000) : String(error);

  const result = await tenantDb
    .updateTable("scheduled_messages")
    .set({
      status: exhausted ? "failed" : "scheduled",
      attempts,
      last_error: message,
      next_attempt_at: new Date(Date.now() + getScheduleRetryDelayMs(attempts)),
      updated_at: toDbDate(),
    })
    .where("id", "=", row.id)
    .where("status", "=", "processing")
    .where("next_attempt_at", "=", claimToken)
    .executeTakeFirst();

  logger.warn(
    {
      companyId,
      scheduledMessageId: row.id,
      bulkJobId: row.bulk_job_id,
      attempts,
      exhausted,
      err: formatError(error),
    },
    "Failed to dispatch scheduled message",
  );

  if (exhausted && result.numUpdatedRows > 0n) {
    if (row.bulk_job_id) {
      bulkFailedTotal++;
      // Bulk media is job-owned (other leaves share it) and per-leaf toasts
      // would storm; failures roll up into the single job-level result.
      await broadcastScheduledUpdate(
        companyId,
        row.id,
        row.contact_id,
        "failed",
      );
    } else {
      failedTotal++;
      // The row can never dispatch now; its media object has no other consumer.
      await cleanupScheduledMediaObject(
        tenantDb,
        companyId,
        row.id,
        row.media_url,
      );
      await Promise.all([
        broadcastScheduledUpdate(companyId, row.id, row.contact_id, "failed"),
        broadcastToCompany(companyId, "notification:toast", {
          type: "error",
          title: "Scheduled message failed",
          message: `A scheduled message could not be sent: ${message}`,
        }),
      ]);
    }
  }
  return exhausted;
}

/** Mark a claimed bulk leaf skipped (fenced like every claim mutation). */
async function recordBulkSkip(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  row: ScheduledMessageRow,
  claimToken: Date,
  reason: BulkRecipientSkipReason,
): Promise<void> {
  const result = await tenantDb
    .updateTable("scheduled_messages")
    .set({
      status: "skipped",
      skip_reason: reason,
      attempts: row.attempts + 1,
      updated_at: toDbDate(),
    })
    .where("id", "=", row.id)
    .where("status", "=", "processing")
    .where("next_attempt_at", "=", claimToken)
    .executeTakeFirst();
  if (result.numUpdatedRows > 0n) {
    bulkSkippedTotal++;
    logger.info(
      {
        companyId,
        scheduledMessageId: row.id,
        bulkJobId: row.bulk_job_id,
        reason,
      },
      "Skipped ineligible bulk recipient",
    );
    await broadcastScheduledUpdate(
      companyId,
      row.id,
      row.contact_id,
      "skipped",
    );
  }
}

export async function dispatchCompanyScheduledMessages(
  companyId: string,
): Promise<number> {
  const tenantDb = getTenantConnection(companyId);
  const now = toDbDate();
  const claimUntil = new Date(Date.now() + CLAIM_LEASE_MS);

  // Claim due rows under a short transaction so multiple API replicas never
  // dispatch the same message. A "processing" row past its lease belongs to a
  // crashed dispatcher and is reclaimed.
  const rows = await tenantDb.transaction().execute(async (trx) => {
    // Bulk leaves are excluded here: they dispatch through the paced,
    // budget-locked path below so normal schedules always take priority.
    const claimed = await trx
      .selectFrom("scheduled_messages")
      .selectAll()
      .where("bulk_job_id", "is", null)
      .where("status", "in", ["scheduled", "processing"])
      .where("next_attempt_at", "<=", now)
      .orderBy("scheduled_at", "asc")
      .limit(BATCH_SIZE)
      .forUpdate()
      .skipLocked()
      .execute();

    if (claimed.length > 0) {
      await trx
        .updateTable("scheduled_messages")
        .set({
          status: "processing",
          next_attempt_at: claimUntil,
          updated_at: toDbDate(),
        })
        .where(
          "id",
          "in",
          claimed.map((row) => row.id),
        )
        .execute();
    }
    return claimed;
  });

  let dispatched = 0;
  for (const row of rows) {
    try {
      const result = await sendScheduledMessage(
        tenantDb,
        companyId,
        row,
        claimUntil,
      );
      dispatched++;
      dispatchedTotal++;
      await Promise.all([
        broadcastNewMessageToViewers(
          companyId,
          row.contact_id,
          {
            message: result.formattedMessage,
            conversationId: row.contact_id,
          },
          result.connectionId,
        ),
        broadcastScheduledUpdate(companyId, row.id, row.contact_id, "sent"),
      ]);
      logger.info(
        {
          companyId,
          scheduledMessageId: row.id,
          messageId: result.messageId,
        },
        "Dispatched scheduled message",
      );
    } catch (error) {
      await recordDispatchFailure(tenantDb, companyId, row, claimUntil, error);
    }
  }
  return dispatched;
}

/**
 * Claim at most one due bulk leaf for a connection under the connection's
 * budget row lock. The FOR UPDATE on bulk_connection_budgets serializes every
 * replica and every overlapping job onto one pacing/quota ledger, which is
 * what makes the guarantees hold:
 *
 * - Pacing: next_eligible_at only moves forward inside the lock, so two
 *   replicas can never both send within one interval on a connection.
 * - Daily quota: sent_today is read and incremented inside the same lock and
 *   transaction as the leaf claim; a crash rolls back both together. The
 *   "day" is the database server's CURRENT_DATE (UTC in production).
 * - Budget is charged at claim, not delivery: a downstream error still
 *   consumes the slot, so failures slow bulk sending down, never speed it up.
 * - Disconnected/archived connections claim nothing and burn no attempts;
 *   their backlog simply waits for the connection to come back.
 */
async function claimBulkLeafForConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
  now: Date,
  claimUntil: Date,
): Promise<ScheduledMessageRow | null> {
  return tenantDb.transaction().execute(async (trx) => {
    // Seed the ledger eligible-now (an explicit timestamp, not the column's
    // now() default, which would land after this cycle's captured `now` and
    // needlessly push a brand-new connection to the next poll).
    await trx
      .insertInto("bulk_connection_budgets")
      .values({ whatsapp_connection_id: connectionId, next_eligible_at: now })
      .onConflict((oc) => oc.column("whatsapp_connection_id").doNothing())
      .execute();
    const budget = await trx
      .selectFrom("bulk_connection_budgets")
      .select(["next_eligible_at", "sent_today"])
      .select(sql<boolean>`(quota_date = CURRENT_DATE)`.as("same_day"))
      .where("whatsapp_connection_id", "=", connectionId)
      .forUpdate()
      .executeTakeFirst();
    if (!budget) return null;
    const sentToday = budget.same_day ? budget.sent_today : 0;
    if (sentToday >= bulkConfig.dailyCapPerConnection) return null;
    if (budget.next_eligible_at.getTime() > now.getTime()) return null;

    const connection = await trx
      .selectFrom("whatsapp_connections")
      .select(["id", "status", "archived_at"])
      .where("id", "=", connectionId)
      .executeTakeFirst();
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.archived_at
    ) {
      return null;
    }

    const leaf = await trx
      .selectFrom("scheduled_messages")
      .selectAll()
      .where("bulk_job_id", "is not", null)
      .where("status", "in", ["scheduled", "processing"])
      .where("next_attempt_at", "<=", now)
      .where("contact_id", "in", (eb) =>
        eb
          .selectFrom("contacts")
          .select("contacts.id")
          .where("contacts.whatsapp_connection_id", "=", connectionId),
      )
      .orderBy("scheduled_at", "asc")
      .orderBy("created_at", "asc")
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!leaf) return null;

    await trx
      .updateTable("scheduled_messages")
      .set({
        status: "processing",
        next_attempt_at: claimUntil,
        updated_at: toDbDate(),
      })
      .where("id", "=", leaf.id)
      .execute();
    await trx
      .updateTable("bulk_connection_budgets")
      .set({
        sent_today: sentToday + 1,
        quota_date: sql<Date>`CURRENT_DATE`,
        next_eligible_at: new Date(now.getTime() + bulkConfig.sendIntervalMs),
        updated_at: toDbDate(),
      })
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    return leaf;
  });
}

/**
 * The per-connection claim only sees leaves whose contact still routes to a
 * connection; a recipient deleted or unlinked after the snapshot would wait
 * forever and hang its job. Sweep such orphans to "skipped" so jobs always
 * drain. Guarded by the status filter, so a concurrently claimed leaf is
 * untouched; leaves mid-dispatch have next_attempt_at in the future.
 */
async function sweepOrphanedBulkLeaves(
  tenantDb: Kysely<TenantDatabase>,
  now: Date,
): Promise<string[]> {
  const affectedJobs = new Set<string>();
  const sweeps: Array<{
    reason: BulkRecipientSkipReason;
    orphanFilter: "missing" | "unlinked";
  }> = [
    { reason: "contact_missing", orphanFilter: "missing" },
    { reason: "no_connection", orphanFilter: "unlinked" },
  ];
  for (const sweep of sweeps) {
    const rows = await tenantDb
      .updateTable("scheduled_messages")
      .set({
        status: "skipped",
        skip_reason: sweep.reason,
        updated_at: toDbDate(),
      })
      .where("status", "in", ["scheduled", "processing"])
      .where("id", "in", (eb) => {
        let orphans = eb
          .selectFrom("scheduled_messages as sm")
          .leftJoin("contacts", "contacts.id", "sm.contact_id")
          .select("sm.id")
          .where("sm.bulk_job_id", "is not", null)
          .where("sm.status", "in", ["scheduled", "processing"])
          .where("sm.next_attempt_at", "<=", now)
          .limit(100);
        orphans =
          sweep.orphanFilter === "missing"
            ? orphans.where("contacts.id", "is", null)
            : orphans
                .where("contacts.id", "is not", null)
                .where("contacts.whatsapp_connection_id", "is", null);
        return orphans;
      })
      .returning(["id", "bulk_job_id"])
      .execute();
    for (const row of rows) {
      bulkSkippedTotal++;
      if (row.bulk_job_id) affectedJobs.add(row.bulk_job_id);
    }
    if (rows.length > 0) {
      logger.info(
        { count: rows.length, reason: sweep.reason },
        "Skipped orphaned bulk leaves",
      );
    }
  }
  return [...affectedJobs];
}

/**
 * Bulk phase: one paced send per connection per cycle, after all normal
 * schedules dispatched. Immediate human sends never pass through here at all
 * (they go straight to the outbox), so bulk pacing cannot delay them beyond
 * the worker's own serial send loop.
 */
export async function dispatchCompanyBulkMessages(
  companyId: string,
): Promise<number> {
  const tenantDb = getTenantConnection(companyId);
  const now = toDbDate();
  const claimUntil = new Date(Date.now() + CLAIM_LEASE_MS);

  const orphanedJobIds = await sweepOrphanedBulkLeaves(tenantDb, now);
  for (const jobId of orphanedJobIds) {
    try {
      await finalizeBulkJobIfComplete(tenantDb, companyId, jobId);
    } catch (error) {
      logger.error(
        { companyId, bulkJobId: jobId, err: formatError(error) },
        "Failed to finalize bulk job after orphan sweep",
      );
    }
  }

  // Candidate connections are pre-filtered to those that look eligible right
  // now (connected, unarchived, not paced out, quota remaining) and ordered
  // oldest-eligible-first, so paced-out or quota-exhausted connections never
  // occupy the per-cycle limit and starve eligible ones. This filter is only
  // advisory — the locked claim transaction below remains the authority.
  const candidates = await tenantDb
    .selectFrom("whatsapp_connections as wc")
    .leftJoin(
      "bulk_connection_budgets as budget",
      "budget.whatsapp_connection_id",
      "wc.id",
    )
    .select("wc.id as connectionId")
    .where("wc.status", "=", "connected")
    .where("wc.archived_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("budget.whatsapp_connection_id", "is", null),
        eb.and([
          eb("budget.next_eligible_at", "<=", now),
          eb.or([
            sql<boolean>`budget.quota_date <> CURRENT_DATE`,
            eb("budget.sent_today", "<", bulkConfig.dailyCapPerConnection),
          ]),
        ]),
      ]),
    )
    .where("wc.id", "in", (eb) =>
      eb
        .selectFrom("scheduled_messages as sm")
        .innerJoin("contacts as ct", "ct.id", "sm.contact_id")
        .select("ct.whatsapp_connection_id")
        .where("sm.bulk_job_id", "is not", null)
        .where("sm.status", "in", ["scheduled", "processing"])
        .where("sm.next_attempt_at", "<=", now)
        .where("ct.whatsapp_connection_id", "is not", null),
    )
    .orderBy(sql`budget.next_eligible_at ASC NULLS FIRST`)
    .orderBy("wc.id", "asc")
    .limit(BULK_CONNECTIONS_PER_CYCLE)
    .execute();
  if (candidates.length === 0) return 0;

  let dispatched = 0;
  for (const candidate of candidates) {
    const connectionId = candidate.connectionId;
    if (!connectionId) continue;
    let leaf: ScheduledMessageRow | null = null;
    try {
      leaf = await claimBulkLeafForConnection(
        tenantDb,
        connectionId,
        now,
        claimUntil,
      );
    } catch (error) {
      logger.error(
        { companyId, connectionId, err: formatError(error) },
        "Failed to claim bulk leaf",
      );
      continue;
    }
    if (!leaf) continue;
    const bulkJobId = leaf.bulk_job_id;
    if (bulkJobId) {
      await markBulkJobRunning(tenantDb, companyId, bulkJobId);
    }

    try {
      const result = await sendScheduledMessage(
        tenantDb,
        companyId,
        leaf,
        claimUntil,
      );
      dispatched++;
      bulkDispatchedTotal++;
      await Promise.all([
        broadcastNewMessageToViewers(
          companyId,
          leaf.contact_id,
          {
            message: result.formattedMessage,
            conversationId: leaf.contact_id,
          },
          result.connectionId,
        ),
        broadcastScheduledUpdate(companyId, leaf.id, leaf.contact_id, "sent"),
      ]);
      logger.info(
        {
          companyId,
          bulkJobId,
          scheduledMessageId: leaf.id,
          messageId: result.messageId,
          connectionId,
        },
        "Dispatched bulk message",
      );
    } catch (error) {
      if (error instanceof BulkSkipError) {
        await recordBulkSkip(
          tenantDb,
          companyId,
          leaf,
          claimUntil,
          error.reason,
        );
      } else {
        await recordDispatchFailure(
          tenantDb,
          companyId,
          leaf,
          claimUntil,
          error,
        );
      }
    }

    if (bulkJobId) {
      try {
        await finalizeBulkJobIfComplete(tenantDb, companyId, bulkJobId);
      } catch (error) {
        logger.error(
          { companyId, bulkJobId, err: formatError(error) },
          "Failed to finalize bulk job",
        );
      }
    }
  }
  return dispatched;
}

export async function dispatchDueScheduledMessages(): Promise<number> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .execute();

  let processed = 0;
  for (const company of companies) {
    try {
      processed += await dispatchCompanyScheduledMessages(company.id);
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Failed to dispatch company scheduled messages",
      );
    }
    try {
      processed += await dispatchCompanyBulkMessages(company.id);
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Failed to dispatch company bulk messages",
      );
    }
  }
  return processed;
}

async function poll(): Promise<void> {
  if (running || stopping) return;
  running = true;
  lastPollAt = new Date();
  try {
    await dispatchDueScheduledMessages();
  } catch (error) {
    logger.error({ err: formatError(error) }, "Scheduled message poll failed");
  } finally {
    running = false;
    if (!stopping) timer = setTimeout(poll, POLL_INTERVAL_MS);
  }
}

export function initializeScheduledMessages(): void {
  if (timer || running) return;
  stopping = false;
  timer = setTimeout(poll, 0);
  logger.info("Scheduled message dispatcher initialized");
}

export async function shutdownScheduledMessages(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  logger.info("Scheduled message dispatcher stopped");
}
