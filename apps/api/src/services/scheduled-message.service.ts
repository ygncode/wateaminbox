/**
 * Scheduled Message Service
 *
 * Persists outbound messages for future delivery and dispatches them when due.
 * Dispatch reuses the canonical send pipeline: a pending `messages` row plus a
 * command outbox entry are committed in the same transaction that marks the
 * scheduled row sent, so a crash or a concurrent replica can never double-send.
 */

import { db } from "@wateaminbox/database";
import type { ScheduledMessage, ScheduledMessageStatus } from "@wateaminbox/shared";
import { toDbDate } from "@wateaminbox/shared";
import { createLogger, formatError } from "../lib/logger.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../lib/nats/index.js";
import { broadcastToCompany } from "../lib/realtime.js";
import { enqueueCommand } from "./command-outbox.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";
import { getUserAvatarSources, getUserNames } from "./user.service.js";
import { getActiveSessionId } from "./whatsapp/session.js";

import type { Kysely, Selectable, Transaction } from "kysely";
import type { ScheduledMessagesTable } from "@wateaminbox/database";

const logger = createLogger("ScheduledMessages");
const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 10;
const CLAIM_LEASE_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;
let lastPollAt: Date | null = null;
let dispatchedTotal = 0;
let failedTotal = 0;

export function getScheduledMessageHealth() {
  return {
    initialized: timer !== null || running,
    running,
    stopping,
    lastPollAt,
    dispatchedTotal,
    failedTotal,
  };
}

export type ScheduledMessageRow = Selectable<ScheduledMessagesTable>;

export function formatScheduledMessage(
  row: ScheduledMessageRow,
  createdByName?: string,
): ScheduledMessage {
  return {
    id: row.id,
    contactId: row.contact_id,
    content: row.content,
    messageType: row.message_type,
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
  await broadcastToCompany(companyId, "scheduled_message:updated", {
    scheduledMessageId,
    conversationId: contactId,
    status,
  });
}

/** A dispatch failure that retrying can never fix (e.g. deleted contact). */
class PermanentDispatchError extends Error {}

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
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", row.contact_id)
    .executeTakeFirst();

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
    undefined,
    quotedWaMessageId,
    quotedSenderJid,
  );

  await tenantDb.transaction().execute(async (trx) => {
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
        quoted_message_id: quotedWaMessageId || null,
        sent_by_user_id: row.created_by,
        status: "pending",
        timestamp: createdAt,
        created_at: createdAt,
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
      throw new PermanentDispatchError("Scheduled message is no longer claimed");
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
): Promise<void> {
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
      attempts,
      exhausted,
      err: formatError(error),
    },
    "Failed to dispatch scheduled message",
  );

  if (exhausted && result.numUpdatedRows > 0n) {
    failedTotal++;
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
    const claimed = await trx
      .selectFrom("scheduled_messages")
      .selectAll()
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
        broadcastToCompany(
          companyId,
          "message:new",
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
