/**
 * Bulk Broadcast Job Service
 *
 * A bulk job is a parent row plus one scheduled_messages leaf per resolved
 * audience member, materialized atomically at creation time (never at
 * dispatch). Leaves flow through the existing scheduled-message dispatcher;
 * everything here is snapshotting, bookkeeping, and rollup:
 *
 * - Audience resolution is deterministic (stable ordering, jid dedupe) and
 *   hashed, so preview → confirm cannot silently drift.
 * - Personalization renders at snapshot; each leaf stores its exact content.
 * - Progress/terminal status derive from leaf states, never stored counters.
 * - Shared media is job-owned: leaf-level cleanup skips bulk leaves, and the
 *   object is reclaimed at finalization only if no sent message references it.
 */

import { createHash } from "node:crypto";
import type { BulkJobsTable } from "@wateaminbox/database";
import type {
  BulkJob,
  BulkJobAudience,
  BulkJobPreview,
  BulkJobProgress,
  BulkJobStatus,
  BulkRecipientSkipReason,
} from "@wateaminbox/shared";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely, Selectable } from "kysely";
import { bulkConfig } from "../config/bulk.config.js";
import { ConflictError, ValidationError } from "../lib/errors.js";
import { createLogger, formatError } from "../lib/logger.js";
import { broadcastToCompany } from "../lib/realtime.js";
import { deleteMedia, resolveMediaKeyForCompany } from "../lib/storage.js";
import { createAuditLog } from "./audit.service.js";
import type { TenantDatabase } from "./tenant.service.js";

const logger = createLogger("BulkJobs");

/** Upper bound on snapshotted rows (eligible + skipped) for one job. */
const MAX_RESOLVED_AUDIENCE = 2_000;
const LEAF_INSERT_CHUNK = 500;

export type BulkJobRow = Selectable<BulkJobsTable>;

// ============================================================================
// Personalization
// ============================================================================

const TEMPLATE_TOKEN_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const TEMPLATE_VARIABLES = ["name", "firstName"] as const;

/** Returns the unknown variable names used in a template ([] when valid). */
export function findUnknownTemplateVariables(content: string): string[] {
  const unknown = new Set<string>();
  for (const match of content.matchAll(TEMPLATE_TOKEN_RE)) {
    const variable = match[1];
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(variable)) {
      unknown.add(variable);
    }
  }
  return [...unknown];
}

export interface RecipientNameSource {
  custom_name: string | null;
  push_name: string | null;
  phone_number: string | null;
}

export function resolveRecipientName(contact: RecipientNameSource): string {
  return (
    contact.custom_name?.trim() ||
    contact.push_name?.trim() ||
    contact.phone_number ||
    ""
  );
}

/**
 * Render a validated template for one recipient. Unknown variables were
 * rejected at validation; if one slips through it renders as empty rather
 * than leaking literal braces to a customer.
 */
export function renderBulkTemplate(
  content: string,
  contact: RecipientNameSource,
): string {
  const name = resolveRecipientName(contact);
  const firstName = name.split(/\s+/)[0] ?? "";
  return content.replace(TEMPLATE_TOKEN_RE, (_token, variable: string) => {
    if (variable === "name") return name;
    if (variable === "firstName") return firstName;
    return "";
  });
}

// ============================================================================
// Audience resolution
// ============================================================================

export interface ResolvedRecipient {
  contactId: string;
  jid: string | null;
  connectionId: string | null;
  connectionName: string | null;
  customName: string | null;
  pushName: string | null;
  phoneNumber: string | null;
  skipReason: BulkRecipientSkipReason | null;
}

export interface ResolvedAudience {
  eligible: ResolvedRecipient[];
  skipped: ResolvedRecipient[];
  audienceHash: string;
}

/**
 * Deterministic hash of the exact previewed snapshot (order-independent).
 * Covers everything that affects counts or delivery: each eligible
 * recipient's identity, routing connection, and target jid, plus every
 * skipped recipient and its classification. Moving a contact between
 * connections, a jid change, or a skip reclassification all change the hash,
 * forcing a fresh preview before creation.
 */
export function computeAudienceHash(
  eligible: Array<{
    contactId: string;
    connectionId: string | null;
    jid: string | null;
  }>,
  skipped: Array<{ contactId: string; skipReason: string | null }>,
): string {
  const lines = [
    ...eligible.map(
      (r) => `e:${r.contactId}:${r.connectionId ?? ""}:${r.jid ?? ""}`,
    ),
    ...skipped.map((r) => `s:${r.contactId}:${r.skipReason ?? ""}`),
  ].sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/**
 * Resolve an audience definition to concrete recipients with eligibility
 * verdicts. Deterministic: contacts are ordered by (created_at, id) and jid
 * duplicates keep the earliest contact, so the same database state always
 * yields the same recipient set and hash.
 */
export async function resolveBulkAudience(
  tenantDb: Kysely<TenantDatabase>,
  audience: BulkJobAudience,
): Promise<ResolvedAudience> {
  const contacts = await tenantDb
    .selectFrom("contacts")
    .leftJoin(
      "whatsapp_connections",
      "whatsapp_connections.id",
      "contacts.whatsapp_connection_id",
    )
    .select([
      "contacts.id",
      "contacts.jid",
      "contacts.phone_number",
      "contacts.push_name",
      "contacts.custom_name",
      "contacts.is_group",
      "contacts.is_blocked",
      "contacts.whatsapp_connection_id",
      "whatsapp_connections.id as connection_id",
      "whatsapp_connections.name as connection_name",
      "whatsapp_connections.archived_at as connection_archived_at",
    ])
    .where((eb) => {
      const conditions = [];
      if (audience.contactIds.length > 0) {
        conditions.push(eb("contacts.id", "in", audience.contactIds));
      }
      if (audience.tagIds.length > 0) {
        conditions.push(
          eb(
            "contacts.id",
            "in",
            eb
              .selectFrom("contact_tags")
              .select("contact_tags.contact_id")
              .where("contact_tags.tag_id", "in", audience.tagIds),
          ),
        );
      }
      return eb.or(conditions);
    })
    .orderBy("contacts.created_at", "asc")
    .orderBy("contacts.id", "asc")
    .execute();

  const eligible: ResolvedRecipient[] = [];
  const skipped: ResolvedRecipient[] = [];
  const seenJids = new Set<string>();

  for (const contact of contacts) {
    const recipient: ResolvedRecipient = {
      contactId: contact.id,
      jid: contact.jid,
      connectionId: contact.connection_id,
      connectionName: contact.connection_name,
      customName: contact.custom_name,
      pushName: contact.push_name,
      phoneNumber: contact.phone_number,
      skipReason: null,
    };

    if (contact.is_group) {
      recipient.skipReason = "is_group";
    } else if (!contact.jid) {
      recipient.skipReason = "no_jid";
    } else if (contact.is_blocked) {
      recipient.skipReason = "blocked";
    } else if (!contact.whatsapp_connection_id || !contact.connection_id) {
      recipient.skipReason = "no_connection";
    } else if (contact.connection_archived_at) {
      recipient.skipReason = "connection_archived";
    } else if (
      audience.connectionId &&
      contact.whatsapp_connection_id !== audience.connectionId
    ) {
      recipient.skipReason = "connection_filtered";
    } else if (seenJids.has(contact.jid)) {
      recipient.skipReason = "duplicate_jid";
    }

    if (recipient.skipReason) {
      skipped.push(recipient);
    } else {
      seenJids.add(contact.jid as string);
      eligible.push(recipient);
    }
  }

  return {
    eligible,
    skipped,
    audienceHash: computeAudienceHash(eligible, skipped),
  };
}

// ============================================================================
// Preview
// ============================================================================

export function buildBulkJobPreview(
  resolved: ResolvedAudience,
): BulkJobPreview {
  const perConnection = new Map<
    string,
    {
      connectionId: string;
      connectionName: string | null;
      recipientCount: number;
    }
  >();
  for (const recipient of resolved.eligible) {
    if (!recipient.connectionId) continue;
    const entry = perConnection.get(recipient.connectionId) ?? {
      connectionId: recipient.connectionId,
      connectionName: recipient.connectionName,
      recipientCount: 0,
    };
    entry.recipientCount++;
    perConnection.set(recipient.connectionId, entry);
  }

  const skippedByReason: Partial<Record<BulkRecipientSkipReason, number>> = {};
  for (const recipient of resolved.skipped) {
    if (!recipient.skipReason) continue;
    skippedByReason[recipient.skipReason] =
      (skippedByReason[recipient.skipReason] ?? 0) + 1;
  }

  const sendIntervalSeconds = Math.ceil(bulkConfig.sendIntervalMs / 1000);
  const busiestConnection = Math.max(
    0,
    ...[...perConnection.values()].map((c) => c.recipientCount),
  );

  return {
    recipientCount: resolved.eligible.length,
    skippedCount: resolved.skipped.length,
    perConnection: [...perConnection.values()],
    skippedByReason,
    audienceHash: resolved.audienceHash,
    estimatedDurationSeconds: busiestConnection * sendIntervalSeconds,
    limits: {
      sendIntervalSeconds,
      maxRecipientsPerJob: bulkConfig.maxRecipientsPerJob,
      dailyCapPerConnection: bulkConfig.dailyCapPerConnection,
    },
  };
}

// ============================================================================
// Creation
// ============================================================================

export interface CreateBulkJobParams {
  name: string;
  audience: BulkJobAudience;
  content: string;
  messageType: "text" | "image" | "video" | "document";
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  scheduledAt: Date;
  audienceHash: string;
  idempotencyKey: string;
  createdBy: string;
}

export class BulkAudienceDriftError extends ConflictError {
  constructor(public readonly preview: BulkJobPreview) {
    super("The audience changed since the preview; please confirm again");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

export interface CreateBulkJobResult {
  job: BulkJobRow;
  created: boolean;
}

/**
 * Create a job and materialize its recipient leaves in one transaction.
 *
 * Guarantees:
 * - Idempotent: a retried or concurrently repeated create with the same
 *   idempotency key returns the first call's job; the partial unique index
 *   makes the race lose cleanly (23505) instead of double-snapshotting.
 * - Drift-safe: the audience is re-resolved here and must hash to the value
 *   the caller previewed, otherwise BulkAudienceDriftError carries a fresh
 *   preview for re-confirmation.
 * - Atomic: the job row and every leaf commit together; there is no state
 *   where a job exists with a partial audience.
 */
export async function createBulkJob(
  tenantDb: Kysely<TenantDatabase>,
  params: CreateBulkJobParams,
): Promise<CreateBulkJobResult> {
  const unknownVariables = findUnknownTemplateVariables(params.content);
  if (unknownVariables.length > 0) {
    throw new ValidationError(
      `Unknown template variables: ${unknownVariables.join(", ")}`,
    );
  }

  const existing = await findJobByIdempotencyKey(
    tenantDb,
    params.idempotencyKey,
  );
  if (existing) return replayOrConflict(existing, params);

  const resolved = await resolveBulkAudience(tenantDb, params.audience);
  if (resolved.audienceHash !== params.audienceHash) {
    throw new BulkAudienceDriftError(buildBulkJobPreview(resolved));
  }
  if (resolved.eligible.length === 0) {
    throw new ValidationError("The audience has no eligible recipients");
  }
  if (resolved.eligible.length > bulkConfig.maxRecipientsPerJob) {
    throw new ValidationError(
      `The audience exceeds the per-job limit of ${bulkConfig.maxRecipientsPerJob} recipients`,
    );
  }
  if (
    resolved.eligible.length + resolved.skipped.length >
    MAX_RESOLVED_AUDIENCE
  ) {
    throw new ValidationError("The audience is too large to snapshot");
  }

  const now = toDbDate();
  try {
    const job = await tenantDb.transaction().execute(async (trx) => {
      const jobRow = await trx
        .insertInto("bulk_jobs")
        .values({
          id: crypto.randomUUID(),
          name: params.name,
          status: "scheduled",
          content: params.content,
          message_type: params.messageType,
          media_url: params.mediaUrl,
          media_mime_type: params.mediaMimeType,
          media_file_name: params.mediaFileName,
          audience: params.audience,
          audience_hash: resolved.audienceHash,
          scheduled_at: params.scheduledAt,
          total_recipients: resolved.eligible.length,
          skipped_recipients: resolved.skipped.length,
          idempotency_key: params.idempotencyKey,
          created_by: params.createdBy,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const leaves = [
        ...resolved.eligible.map((recipient) => ({
          skipReason: null as string | null,
          recipient,
        })),
        ...resolved.skipped.map((recipient) => ({
          skipReason: recipient.skipReason as string | null,
          recipient,
        })),
      ].map(({ skipReason, recipient }) => ({
        id: crypto.randomUUID(),
        contact_id: recipient.contactId,
        content: renderBulkTemplate(params.content, {
          custom_name: recipient.customName,
          push_name: recipient.pushName,
          phone_number: recipient.phoneNumber,
        }),
        message_type: params.messageType,
        media_url: params.mediaUrl,
        media_mime_type: params.mediaMimeType,
        media_file_name: params.mediaFileName,
        reply_to_message_id: null,
        scheduled_at: params.scheduledAt,
        status: (skipReason ? "skipped" : "scheduled") as
          | "skipped"
          | "scheduled",
        attempts: 0,
        next_attempt_at: params.scheduledAt,
        created_by: params.createdBy,
        bulk_job_id: jobRow.id,
        skip_reason: skipReason,
        created_at: now,
        updated_at: now,
      }));

      for (let i = 0; i < leaves.length; i += LEAF_INSERT_CHUNK) {
        await trx
          .insertInto("scheduled_messages")
          .values(leaves.slice(i, i + LEAF_INSERT_CHUNK))
          .execute();
      }

      return jobRow;
    });
    return { job, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent create with the same key won the race; return its job.
      const winner = await findJobByIdempotencyKey(
        tenantDb,
        params.idempotencyKey,
      );
      if (winner) return replayOrConflict(winner, params);
    }
    throw error;
  }
}

function canonicalAudience(audience: BulkJobAudience): string {
  return JSON.stringify({
    tagIds: [...audience.tagIds].sort(),
    contactIds: [...audience.contactIds].sort(),
    connectionId: audience.connectionId ?? null,
  });
}

/**
 * An idempotency key must always accompany the same request. Replaying the
 * original response is only safe when the material fields match; a reused
 * key with a different body is a client bug and gets a conflict instead of
 * a silently unrelated job.
 */
function replayOrConflict(
  job: BulkJobRow,
  params: CreateBulkJobParams,
): CreateBulkJobResult {
  const matches =
    job.created_by === params.createdBy &&
    job.name === params.name &&
    job.content === params.content &&
    job.message_type === params.messageType &&
    job.media_url === params.mediaUrl &&
    job.scheduled_at.getTime() === params.scheduledAt.getTime() &&
    job.audience_hash === params.audienceHash &&
    canonicalAudience(job.audience) === canonicalAudience(params.audience);
  if (!matches) {
    throw new ConflictError(
      "This idempotency key was already used for a different broadcast",
    );
  }
  return { job, created: false };
}

async function findJobByIdempotencyKey(
  tenantDb: Kysely<TenantDatabase>,
  idempotencyKey: string,
): Promise<BulkJobRow | undefined> {
  return tenantDb
    .selectFrom("bulk_jobs")
    .selectAll()
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
}

// ============================================================================
// Progress & lifecycle
// ============================================================================

export async function getBulkJobProgress(
  tenantDb: Kysely<TenantDatabase>,
  bulkJobId: string,
): Promise<BulkJobProgress> {
  const rows = await tenantDb
    .selectFrom("scheduled_messages")
    .select(["status"])
    .select((eb) => eb.fn.countAll().as("count"))
    .where("bulk_job_id", "=", bulkJobId)
    .groupBy("status")
    .execute();

  const byStatus = new Map(rows.map((r) => [r.status, Number(r.count)]));
  const progress: BulkJobProgress = {
    total: 0,
    pending: byStatus.get("scheduled") ?? 0,
    processing: byStatus.get("processing") ?? 0,
    sent: byStatus.get("sent") ?? 0,
    failed: byStatus.get("failed") ?? 0,
    canceled: byStatus.get("canceled") ?? 0,
    skipped: byStatus.get("skipped") ?? 0,
  };
  progress.total =
    progress.pending +
    progress.processing +
    progress.sent +
    progress.failed +
    progress.canceled +
    progress.skipped;
  return progress;
}

export async function getBulkJobProgressMap(
  tenantDb: Kysely<TenantDatabase>,
  bulkJobIds: string[],
): Promise<Map<string, BulkJobProgress>> {
  const map = new Map<string, BulkJobProgress>();
  if (bulkJobIds.length === 0) return map;
  const rows = await tenantDb
    .selectFrom("scheduled_messages")
    .select(["bulk_job_id", "status"])
    .select((eb) => eb.fn.countAll().as("count"))
    .where("bulk_job_id", "in", bulkJobIds)
    .groupBy(["bulk_job_id", "status"])
    .execute();
  for (const row of rows) {
    const jobId = row.bulk_job_id as string;
    const progress = map.get(jobId) ?? {
      total: 0,
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      canceled: 0,
      skipped: 0,
    };
    const count = Number(row.count);
    switch (row.status) {
      case "scheduled":
        progress.pending += count;
        break;
      case "processing":
        progress.processing += count;
        break;
      case "sent":
        progress.sent += count;
        break;
      case "failed":
        progress.failed += count;
        break;
      case "canceled":
        progress.canceled += count;
        break;
      case "skipped":
        progress.skipped += count;
        break;
    }
    progress.total += count;
    map.set(jobId, progress);
  }
  return map;
}

/**
 * Terminal outcome for a job whose leaves have all settled. "completed" means
 * every snapshotted recipient was handed to the send pipeline; any failed OR
 * skipped recipient (snapshot-time or dispatch-time) is an honest partial
 * outcome and reports as completed_with_errors.
 */
export function deriveBulkJobOutcome(
  progress: BulkJobProgress,
): Extract<BulkJobStatus, "completed" | "completed_with_errors"> {
  return progress.failed > 0 || progress.skipped > 0
    ? "completed_with_errors"
    : "completed";
}

export function formatBulkJob(
  row: BulkJobRow,
  progress: BulkJobProgress,
  createdByName?: string,
  authorizedMediaUrl: string | null = row.media_url,
): BulkJob {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    content: row.content,
    messageType: row.message_type,
    mediaUrl: authorizedMediaUrl,
    mediaMimeType: row.media_mime_type,
    mediaFileName: row.media_file_name,
    audience: row.audience,
    scheduledAt: row.scheduled_at.toISOString(),
    totalRecipients: row.total_recipients,
    progress,
    createdBy: row.created_by,
    createdByName,
    canceledAt: row.canceled_at ? row.canceled_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Reclaim a finished job's shared media object. The object is kept whenever
 * anything may still need it: a message row referencing the same URL (a
 * dispatched leaf copies it verbatim), an undispatched schedule (bulk or
 * single) still carrying it, or another live bulk job sharing the upload.
 */
async function cleanupBulkJobMediaObject(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  job: Pick<BulkJobRow, "id" | "media_url">,
): Promise<void> {
  if (!job.media_url) return;
  try {
    const referencedByMessage = await tenantDb
      .selectFrom("messages")
      .select("id")
      .where("media_url", "=", job.media_url)
      .limit(1)
      .executeTakeFirst();
    if (referencedByMessage) return;
    const referencedByPendingSchedule = await tenantDb
      .selectFrom("scheduled_messages")
      .select("id")
      .where("media_url", "=", job.media_url)
      .where("status", "in", ["scheduled", "processing"])
      .limit(1)
      .executeTakeFirst();
    if (referencedByPendingSchedule) return;
    const referencedBySiblingJob = await tenantDb
      .selectFrom("bulk_jobs")
      .select("id")
      .where("media_url", "=", job.media_url)
      .where("id", "!=", job.id)
      .where("status", "in", ["scheduled", "running"])
      .limit(1)
      .executeTakeFirst();
    if (referencedBySiblingJob) return;
    await deleteMedia(resolveMediaKeyForCompany(job.media_url, companyId));
  } catch (error) {
    logger.warn(
      { companyId, bulkJobId: job.id, err: formatError(error) },
      "Failed to clean up bulk job media object",
    );
  }
}

/**
 * Move a job to its terminal state once no leaf is pending or processing.
 * Race-safe: the guarded UPDATE means exactly one caller (of any replica)
 * observes the transition and emits the single job-level notification.
 * Progress reads take no row locks and finalization only locks the parent CAS;
 * it never holds a leaf while waiting for the parent, preserving the lifecycle
 * lock order used by reschedule/cancel. Canceled jobs only gain completed_at;
 * their status and the cancel-time notification stand.
 */
export async function finalizeBulkJobIfComplete(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  bulkJobId: string,
): Promise<boolean> {
  const job = await tenantDb
    .selectFrom("bulk_jobs")
    .select(["id", "name", "status", "media_url", "created_by"])
    .where("id", "=", bulkJobId)
    .executeTakeFirst();
  if (!job) return false;
  if (job.status === "completed" || job.status === "completed_with_errors") {
    return false;
  }

  const progress = await getBulkJobProgress(tenantDb, bulkJobId);
  if (progress.pending + progress.processing > 0) return false;

  if (job.status === "canceled") {
    await tenantDb
      .updateTable("bulk_jobs")
      .set({ completed_at: toDbDate(), updated_at: toDbDate() })
      .where("id", "=", bulkJobId)
      .where("completed_at", "is", null)
      .execute();
    await cleanupBulkJobMediaObject(tenantDb, companyId, job);
    return false;
  }

  const outcome = deriveBulkJobOutcome(progress);
  const result = await tenantDb
    .updateTable("bulk_jobs")
    .set({
      status: outcome,
      completed_at: toDbDate(),
      updated_at: toDbDate(),
    })
    .where("id", "=", bulkJobId)
    .where("status", "in", ["scheduled", "running"])
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) return false;

  await cleanupBulkJobMediaObject(tenantDb, companyId, job);
  await createAuditLog({
    companyId,
    userId: null,
    action: "bulk_job.completed",
    entityType: "bulk_job",
    entityId: bulkJobId,
    details: {
      name: job.name,
      outcome,
      sent: progress.sent,
      failed: progress.failed,
      skipped: progress.skipped,
    },
  });
  const summaryParts = [
    `${progress.sent} sent`,
    progress.failed > 0 && `${progress.failed} failed`,
    progress.skipped > 0 && `${progress.skipped} skipped`,
  ].filter(Boolean);
  await Promise.all([
    broadcastToCompany(companyId, "bulk_job:updated", {
      bulkJobId,
      status: outcome,
    }),
    broadcastToCompany(companyId, "notification:toast", {
      type: outcome === "completed_with_errors" ? "warning" : "success",
      title: "Broadcast finished",
      message: `"${job.name}" finished: ${summaryParts.join(", ")}`,
    }),
  ]);
  logger.info(
    { companyId, bulkJobId, outcome, ...progress },
    "Bulk job finished",
  );
  return true;
}

/** Flip a scheduled job to running exactly once; broadcasts on transition. */
export async function markBulkJobRunning(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  bulkJobId: string,
): Promise<void> {
  const result = await tenantDb
    .updateTable("bulk_jobs")
    .set({ status: "running", updated_at: toDbDate() })
    .where("id", "=", bulkJobId)
    .where("status", "=", "scheduled")
    .executeTakeFirst();
  if (result.numUpdatedRows > 0n) {
    await broadcastToCompany(companyId, "bulk_job:updated", {
      bulkJobId,
      status: "running",
    });
  }
}

export interface RescheduleBulkJobResult {
  /** False when cancel/dispatch/terminal work won the state transition. */
  didReschedule: boolean;
  previousScheduledAt: Date | null;
  job: BulkJobRow | null;
  updatedLeaves: number;
}

class RescheduleStateConflict extends Error {}

/**
 * Move a broadcast and every materialized recipient leaf to a new start time.
 *
 * Lock order is always parent -> leaves, matching cancelBulkJob. The
 * dispatcher never holds a leaf while locking the parent (mark-running happens
 * only after its claim transaction commits), so waiting for a concurrent leaf
 * claim cannot form a cycle. Once every leaf is locked, any processing/sent/
 * failed/canceled state means dispatch or another terminal action won and the
 * whole transaction rolls back. Otherwise the guarded updates move only time
 * fields; content, recipient IDs, personalized bodies, and media are untouched.
 */
export async function rescheduleBulkJob(
  tenantDb: Kysely<TenantDatabase>,
  bulkJobId: string,
  scheduledAt: Date,
): Promise<RescheduleBulkJobResult> {
  const now = toDbDate();
  try {
    return await tenantDb.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom("bulk_jobs")
        .selectAll()
        .where("id", "=", bulkJobId)
        .forUpdate()
        .executeTakeFirst();
      if (!before || before.status !== "scheduled") {
        throw new RescheduleStateConflict();
      }

      // Lock every leaf after the parent. A dispatcher that already claimed a
      // leaf commits first; READ COMMITTED then returns its processing state
      // here and we reject without changing any of the remaining leaves.
      const leafStates = await trx
        .selectFrom("scheduled_messages")
        .select(["id", "status"])
        .where("bulk_job_id", "=", bulkJobId)
        .orderBy("id", "asc")
        .forUpdate()
        .execute();
      if (
        leafStates.length === 0 ||
        leafStates.some(
          (leaf) => leaf.status !== "scheduled" && leaf.status !== "skipped",
        )
      ) {
        throw new RescheduleStateConflict();
      }

      const leaves = await trx
        .updateTable("scheduled_messages")
        .set({
          scheduled_at: scheduledAt,
          next_attempt_at: scheduledAt,
          updated_at: now,
        })
        .where(
          "id",
          "in",
          leafStates.map((leaf) => leaf.id),
        )
        .where("status", "in", ["scheduled", "skipped"])
        .executeTakeFirst();
      if (Number(leaves.numUpdatedRows) !== leafStates.length) {
        throw new RescheduleStateConflict();
      }

      const job = await trx
        .updateTable("bulk_jobs")
        .set({ scheduled_at: scheduledAt, updated_at: now })
        .where("id", "=", bulkJobId)
        .where("status", "=", "scheduled")
        .returningAll()
        .executeTakeFirst();
      if (!job) throw new RescheduleStateConflict();

      return {
        didReschedule: true,
        previousScheduledAt: before.scheduled_at,
        job,
        updatedLeaves: Number(leaves.numUpdatedRows),
      };
    });
  } catch (error) {
    if (error instanceof RescheduleStateConflict) {
      return {
        didReschedule: false,
        previousScheduledAt: null,
        job: null,
        updatedLeaves: 0,
      };
    }
    throw error;
  }
}

export interface CancelBulkJobResult {
  /** False when the job reached a terminal state before we could cancel. */
  didCancel: boolean;
  canceledLeaves: number;
  stillProcessing: number;
}

/**
 * Cancel a job. The guarded compare-and-set on bulk_jobs is the single
 * authority: whichever caller's UPDATE moves the row out of
 * scheduled/running wins, and everyone else — a duplicate cancel, or a
 * cancel racing finalization — observes zero updated rows and returns
 * didCancel:false with NO side effects (no leaf changes, no broadcast, no
 * cleanup; the route likewise skips its audit log). The CAS, the unsent-leaf
 * cancellation, and the drained-job completed_at stamp commit in ONE
 * transaction, so a crash can never leave a canceled job whose leaves would
 * still dispatch. Leaves already claimed by a dispatcher keep their fencing
 * token, finish normally, and roll up via finalization, which also reclaims
 * media once the job drains; only the winner performs the immediate cleanup
 * when nothing was in flight.
 */
export async function cancelBulkJob(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  job: Pick<BulkJobRow, "id" | "media_url">,
  canceledBy: string,
): Promise<CancelBulkJobResult> {
  const now = toDbDate();
  const outcome = await tenantDb.transaction().execute(async (trx) => {
    const transition = await trx
      .updateTable("bulk_jobs")
      .set({
        status: "canceled",
        canceled_by: canceledBy,
        canceled_at: now,
        updated_at: now,
      })
      .where("id", "=", job.id)
      .where("status", "in", ["scheduled", "running"])
      .executeTakeFirst();
    if (transition.numUpdatedRows === 0n) {
      return null;
    }

    const leaves = await trx
      .updateTable("scheduled_messages")
      .set({
        status: "canceled",
        canceled_by: canceledBy,
        canceled_at: now,
        updated_at: now,
      })
      .where("bulk_job_id", "=", job.id)
      .where("status", "in", ["scheduled", "failed"])
      .executeTakeFirst();

    const processing = await trx
      .selectFrom("scheduled_messages")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("bulk_job_id", "=", job.id)
      .where("status", "=", "processing")
      .executeTakeFirst();
    const stillProcessing = Number(processing?.count ?? 0);

    if (stillProcessing === 0) {
      await trx
        .updateTable("bulk_jobs")
        .set({ completed_at: now, updated_at: now })
        .where("id", "=", job.id)
        .where("completed_at", "is", null)
        .execute();
    }

    return { canceledLeaves: Number(leaves.numUpdatedRows), stillProcessing };
  });

  if (!outcome) {
    return { didCancel: false, canceledLeaves: 0, stillProcessing: 0 };
  }

  if (outcome.stillProcessing === 0) {
    // Nothing in flight: the winner reclaims media now instead of waiting
    // for a poll. Best-effort S3 work stays outside the transaction.
    await cleanupBulkJobMediaObject(tenantDb, companyId, job);
  }

  await broadcastToCompany(companyId, "bulk_job:updated", {
    bulkJobId: job.id,
    status: "canceled",
  });

  return { didCancel: true, ...outcome };
}
