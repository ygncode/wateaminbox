/**
 * Bulk Broadcast Job Routes
 *
 * Preview, create, list, inspect, and cancel bulk jobs. Creation snapshots
 * the audience into scheduled_messages leaves atomically; dispatch/pacing is
 * handled by the scheduled-message service. Every route requires the
 * dedicated bulk permission on top of the normal send permission, and the
 * mutating routes sit in their own conservative rate tier — though the real
 * safety net is the per-connection pacing and daily quota, which do not
 * depend on HTTP request limiting at all.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { createLogger, formatError } from "../lib/logger.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { broadcastToCompany } from "../lib/realtime.js";
import { created, successData, successPaginated } from "../lib/response.js";
import { createPaginationMeta } from "../lib/route-helpers.js";
import {
  createBulkJobSchema,
  listBulkJobRecipientsQuerySchema,
  listBulkJobsQuerySchema,
  previewBulkJobSchema,
  rescheduleBulkJobSchema,
  SCHEDULE_MAX_HORIZON_MS,
  SCHEDULE_MIN_LEAD_MS,
} from "../lib/schemas/index.js";
import {
  getAuthorizedMediaUrlOrNull,
  getMediaObjectReference,
  getPrivateMediaReference,
} from "../lib/storage.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import {
  requireBulkSendPermission,
  requireMessageSendPermission,
} from "../middleware/message-send-policy.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { createAuditLog, getClientIp } from "../services/audit.service.js";
import {
  BulkAudienceDriftError,
  buildBulkJobPreview,
  cancelBulkJob,
  createBulkJob,
  findUnknownTemplateVariables,
  formatBulkJob,
  getBulkJobProgress,
  getBulkJobProgressMap,
  rescheduleBulkJob,
  resolveBulkAudience,
  resolveRecipientName,
} from "../services/bulk-job.service.js";
import { getUserNames } from "../services/user.service.js";

const logger = createLogger("BulkJobRoutes");

const bulkRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.messaging.bulk,
    keyStrategy: "user",
    keyPrefix: "bulk-jobs",
  },
  rateLimitConfig.enabled,
);

export const bulkJobRoutes = new Hono();

bulkJobRoutes.use("/*", authMiddleware);
bulkJobRoutes.use("/*", tenantMiddleware());
// Reads only need the bulk permission; the send surfaces (create/cancel/
// reschedule and preview, which feeds them) attach the shared send-permission
// instance so the message-send policy test can audit them.
bulkJobRoutes.use("/*", requireBulkSendPermission);

/**
 * POST /bulk-jobs/preview - Resolve the audience an exact job would target.
 * Returns counts, per-connection grouping, skip reasons, a pacing estimate,
 * and the audience hash that creation will verify.
 */
bulkJobRoutes.post(
  "/preview",
  requireMessageSendPermission,
  bulkRateLimiter,
  zValidator("json", previewBulkJobSchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const body = c.req.valid("json");

    if (body.content) {
      const unknownVariables = findUnknownTemplateVariables(body.content);
      if (unknownVariables.length > 0) {
        return badRequest(
          c,
          `Unknown template variables: ${unknownVariables.join(", ")}`,
        );
      }
    }

    const resolved = await resolveBulkAudience(tenantDb, body.audience);
    return successData(c, buildBulkJobPreview(resolved));
  },
);

/**
 * POST /bulk-jobs - Create a job and snapshot its recipients.
 * Idempotent via idempotencyKey; drift between the previewed and current
 * audience returns 409 with a fresh preview for re-confirmation.
 */
bulkJobRoutes.post(
  "/",
  requireMessageSendPermission,
  bulkRateLimiter,
  zValidator("json", createBulkJobSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const body = c.req.valid("json");
    const isMediaMessage = body.messageType !== "text";

    // Mirror the single scheduled-message rules exactly.
    if (!isMediaMessage && !body.content?.trim()) {
      return badRequest(c, "content is required for text messages");
    }
    if (isMediaMessage && !body.mediaUrl) {
      return badRequest(c, "mediaUrl is required for media messages");
    }
    if (!isMediaMessage && body.mediaUrl) {
      return badRequest(c, "mediaUrl is not allowed for text messages");
    }

    const scheduledAt = new Date(body.scheduledAt);
    const lead = scheduledAt.getTime() - Date.now();
    if (lead < SCHEDULE_MIN_LEAD_MS) {
      return badRequest(c, "scheduledAt must be at least 30 seconds from now");
    }
    if (lead > SCHEDULE_MAX_HORIZON_MS) {
      return badRequest(c, "scheduledAt must be within one year");
    }

    // Authorize and pin the shared media object, exactly like the single
    // scheduled-message endpoint does.
    let mediaMimeType: string | null = null;
    let mediaFileName: string | null = null;
    let storedMediaReference: string | null = null;
    if (isMediaMessage && body.mediaUrl) {
      let reference: Awaited<ReturnType<typeof getMediaObjectReference>>;
      try {
        reference = await getMediaObjectReference(body.mediaUrl, companyId);
      } catch (error) {
        logger.warn(
          { companyId, err: formatError(error) },
          "Rejected bulk job media reference",
        );
        return badRequest(c, "Invalid media object for scheduling");
      }
      const expectedPrefix =
        body.messageType === "image"
          ? "image/"
          : body.messageType === "video"
            ? "video/"
            : null;
      if (expectedPrefix && !reference.mimeType.startsWith(expectedPrefix)) {
        return badRequest(
          c,
          `messageType ${body.messageType} does not match the uploaded file type`,
        );
      }
      mediaMimeType = reference.mimeType;
      mediaFileName = reference.filename;
      storedMediaReference = getPrivateMediaReference(reference.key);
    }

    let result: Awaited<ReturnType<typeof createBulkJob>>;
    try {
      result = await createBulkJob(tenantDb, {
        companyId,
        name: body.name,
        audience: body.audience,
        content: body.content?.trim() || "",
        messageType: body.messageType,
        mediaUrl: storedMediaReference,
        mediaMimeType,
        mediaFileName,
        scheduledAt,
        audienceHash: body.audienceHash,
        idempotencyKey: body.idempotencyKey,
        createdBy: user.id,
      });
    } catch (error) {
      if (error instanceof BulkAudienceDriftError) {
        return c.json(
          {
            error: "The audience changed since the preview",
            code: "audience_changed",
            preview: error.preview,
          },
          409,
        );
      }
      throw error;
    }

    const progress = await getBulkJobProgress(tenantDb, result.job.id);
    const job = formatBulkJob(
      result.job,
      progress,
      user.name || user.email.split("@")[0],
      await getAuthorizedMediaUrlOrNull(result.job.media_url, companyId),
    );

    if (result.created) {
      await createAuditLog({
        companyId,
        userId: user.id,
        action: "bulk_job.created",
        entityType: "bulk_job",
        entityId: result.job.id,
        details: {
          name: result.job.name,
          recipients: result.job.total_recipients,
          skipped: result.job.skipped_recipients,
          scheduledAt: body.scheduledAt,
          messageType: body.messageType,
        },
        ipAddress: getClientIp(c),
      });
      await broadcastToCompany(companyId, "bulk_job:updated", {
        bulkJobId: result.job.id,
        status: result.job.status,
      });
      return created(c, job);
    }
    // Idempotent replay of an earlier create.
    return successData(c, job);
  },
);

/**
 * PATCH /bulk-jobs/:id/schedule - Move a truly not-started broadcast.
 * The service updates the parent and already-materialized leaves in one
 * guarded transaction; dispatch/cancel races return a controlled conflict.
 */
bulkJobRoutes.patch(
  "/:id/schedule",
  requireMessageSendPermission,
  bulkRateLimiter,
  zValidator("json", rescheduleBulkJobSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const id = c.req.param("id")!;
    const body = c.req.valid("json");
    const scheduledAt = new Date(body.scheduledAt);
    const lead = scheduledAt.getTime() - Date.now();
    if (lead < SCHEDULE_MIN_LEAD_MS) {
      return badRequest(c, "scheduledAt must be at least 30 seconds from now");
    }
    if (lead > SCHEDULE_MAX_HORIZON_MS) {
      return badRequest(c, "scheduledAt must be within one year");
    }

    const existing = await tenantDb
      .selectFrom("bulk_jobs")
      .select(["id", "name"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!existing) return notFound(c, "Bulk job");

    const result = await rescheduleBulkJob(tenantDb, id, scheduledAt);
    if (!result.didReschedule || !result.job || !result.previousScheduledAt) {
      return conflict(
        c,
        "Only scheduled broadcasts that have not started can be rescheduled",
      );
    }

    const [progress, names] = await Promise.all([
      getBulkJobProgress(tenantDb, id),
      getUserNames([result.job.created_by]),
    ]);
    const job = formatBulkJob(
      result.job,
      progress,
      names.get(result.job.created_by),
      await getAuthorizedMediaUrlOrNull(result.job.media_url, companyId),
    );

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "bulk_job.rescheduled",
      entityType: "bulk_job",
      entityId: id,
      details: {
        name: existing.name,
        previousScheduledAt: result.previousScheduledAt.toISOString(),
        scheduledAt: scheduledAt.toISOString(),
        recipientRows: result.updatedLeaves,
      },
      ipAddress: getClientIp(c),
    });
    await broadcastToCompany(companyId, "bulk_job:updated", {
      bulkJobId: id,
      status: "scheduled",
    });

    return successData(c, job);
  },
);

/**
 * GET /bulk-jobs - List jobs (newest first) with derived progress.
 */
bulkJobRoutes.get(
  "/",
  zValidator("query", listBulkJobsQuerySchema),
  async (c) => {
    const { tenantDb, companyId } = getRouteContext(c);
    const { limit, offset } = c.req.valid("query");

    const countResult = await tenantDb
      .selectFrom("bulk_jobs")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirst();
    const total = Number(countResult?.total || 0);

    const rows = await tenantDb
      .selectFrom("bulk_jobs")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    const [progressMap, names] = await Promise.all([
      getBulkJobProgressMap(
        tenantDb,
        rows.map((row) => row.id),
      ),
      getUserNames(rows.map((row) => row.created_by)),
    ]);

    const jobs = await Promise.all(
      rows.map(async (row) =>
        formatBulkJob(
          row,
          progressMap.get(row.id) ?? {
            total: 0,
            pending: 0,
            processing: 0,
            sent: 0,
            failed: 0,
            canceled: 0,
            skipped: 0,
          },
          names.get(row.created_by),
          await getAuthorizedMediaUrlOrNull(row.media_url, companyId),
        ),
      ),
    );

    return successPaginated(
      c,
      jobs,
      createPaginationMeta(total, jobs.length, { limit, offset }),
    );
  },
);

/**
 * GET /bulk-jobs/:id - Job detail with derived progress.
 */
bulkJobRoutes.get("/:id", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  const id = c.req.param("id")!;

  const row = await tenantDb
    .selectFrom("bulk_jobs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return notFound(c, "Bulk job");

  const [progress, names] = await Promise.all([
    getBulkJobProgress(tenantDb, row.id),
    getUserNames([row.created_by]),
  ]);
  return successData(
    c,
    formatBulkJob(
      row,
      progress,
      names.get(row.created_by),
      await getAuthorizedMediaUrlOrNull(row.media_url, companyId),
    ),
  );
});

/**
 * GET /bulk-jobs/:id/recipients - Paginated per-recipient outcomes.
 */
bulkJobRoutes.get(
  "/:id/recipients",
  zValidator("query", listBulkJobRecipientsQuerySchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const id = c.req.param("id")!;
    const { limit, offset, status } = c.req.valid("query");

    const job = await tenantDb
      .selectFrom("bulk_jobs")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!job) return notFound(c, "Bulk job");

    let countQuery = tenantDb
      .selectFrom("scheduled_messages")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .where("bulk_job_id", "=", id);
    if (status) countQuery = countQuery.where("status", "=", status);
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.total || 0);

    let query = tenantDb
      .selectFrom("scheduled_messages")
      .leftJoin("contacts", "contacts.id", "scheduled_messages.contact_id")
      .select([
        "scheduled_messages.id",
        "scheduled_messages.contact_id",
        "scheduled_messages.status",
        "scheduled_messages.skip_reason",
        "scheduled_messages.last_error",
        "scheduled_messages.scheduled_at",
        "scheduled_messages.sent_at",
        "contacts.custom_name",
        "contacts.push_name",
        "contacts.phone_number",
      ])
      .where("scheduled_messages.bulk_job_id", "=", id)
      .orderBy("scheduled_messages.created_at", "asc")
      .orderBy("scheduled_messages.id", "asc")
      .limit(limit)
      .offset(offset);
    if (status) {
      query = query.where("scheduled_messages.status", "=", status);
    }
    const rows = await query.execute();

    const recipients = rows.map((row) => ({
      id: row.id,
      contactId: row.contact_id,
      contactName:
        resolveRecipientName({
          custom_name: row.custom_name,
          push_name: row.push_name,
          phone_number: row.phone_number,
        }) || null,
      contactPhone: row.phone_number,
      status: row.status,
      skipReason: row.skip_reason,
      lastError: row.last_error,
      scheduledAt: row.scheduled_at.toISOString(),
      sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    }));

    return successPaginated(
      c,
      recipients,
      createPaginationMeta(total, recipients.length, { limit, offset }),
    );
  },
);

/**
 * POST /bulk-jobs/:id/cancel - Cancel a job's unsent recipients.
 * Leaves already claimed by a dispatcher finish under their fencing token.
 */
bulkJobRoutes.post(
  "/:id/cancel",
  requireMessageSendPermission,
  bulkRateLimiter,
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const id = c.req.param("id")!;

    const row = await tenantDb
      .selectFrom("bulk_jobs")
      .select(["id", "name", "status", "media_url"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return notFound(c, "Bulk job");
    if (row.status !== "scheduled" && row.status !== "running") {
      return badRequest(
        c,
        "Only scheduled or running broadcasts can be canceled",
      );
    }

    const result = await cancelBulkJob(tenantDb, companyId, row, user.id);
    if (!result.didCancel) {
      // The job finished between our status check and the guarded transition.
      return badRequest(c, "This broadcast already finished");
    }

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "bulk_job.canceled",
      entityType: "bulk_job",
      entityId: id,
      details: {
        name: row.name,
        canceledLeaves: result.canceledLeaves,
        stillProcessing: result.stillProcessing,
      },
      ipAddress: getClientIp(c),
    });

    return successData(c, result);
  },
);
