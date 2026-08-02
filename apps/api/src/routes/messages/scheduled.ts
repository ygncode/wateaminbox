/**
 * Scheduled Message Routes
 *
 * Create, list, and cancel outbound messages scheduled for future delivery.
 * Dispatch is handled server-side by the scheduled-message service.
 */

import { zValidator } from "@hono/zod-validator";
import { toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import {
  listScheduledMessagesQuerySchema,
  SCHEDULE_MAX_HORIZON_MS,
  SCHEDULE_MIN_LEAD_MS,
  scheduleMessageSchema,
} from "../../lib/schemas/index.js";
import { getMediaObjectReference } from "../../lib/storage.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import { hasContactVisibility } from "../../middleware/resource-visibility.js";
import { broadcastAutoAssignment } from "../../services/assignment-broadcast.service.js";
import { finalizeBulkJobIfComplete } from "../../services/bulk-job.service.js";
import {
  cleanupScheduledMediaObject,
  formatScheduledMessage,
  type ScheduledMessageRow,
} from "../../services/scheduled-message.service.js";
import { requireSendAccess } from "../../services/send-access.service.js";
import { getUserNames } from "../../services/user.service.js";

const logger = createLogger("ScheduledMessageRoutes");

const scheduleRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.messaging.send,
    keyStrategy: "user",
    keyPrefix: "messaging-schedule",
  },
  rateLimitConfig.enabled,
);

export const scheduledRoutes = new Hono();

/**
 * POST /scheduled - Schedule a message for future delivery
 * Requires can_send_messages permission
 */
scheduledRoutes.post(
  "/scheduled",
  requireMessageSendPermission,
  scheduleRateLimiter,
  zValidator("json", scheduleMessageSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const body = c.req.valid("json");
    const isMediaMessage = body.messageType !== "text";

    // Mirror the immediate-send rules: text needs content, media needs a
    // media object; content doubles as the optional caption.
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

    // Authorize and pin the media object now so a bad reference fails fast
    // instead of at dispatch time: the HEAD proves the object exists, belongs
    // to this tenant, and is within the size limit, and yields canonical
    // mime/filename for display.
    let mediaMimeType: string | null = null;
    let mediaFileName: string | null = null;
    if (isMediaMessage && body.mediaUrl) {
      let reference: Awaited<ReturnType<typeof getMediaObjectReference>>;
      try {
        reference = await getMediaObjectReference(body.mediaUrl, companyId);
      } catch (error) {
        logger.warn(
          { companyId, err: formatError(error) },
          "Rejected scheduled message media reference",
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
    }

    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", body.contactId)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Contact or JID");
    }

    // The connection is re-resolved at dispatch time; it only needs to exist
    // now so the schedule isn't doomed from the start.
    if (!contact.whatsapp_connection_id) {
      return badRequest(c, "The contact has no WhatsApp connection");
    }

    if (body.replyToMessageId) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select("id")
        .where("id", "=", body.replyToMessageId)
        .where("contact_id", "=", body.contactId)
        .executeTakeFirst();
      if (!quotedMessage) {
        return notFound(c, "Quoted message");
      }
    }

    // Scheduling is itself a live, user-triggered action - it goes through
    // the exact same guard an immediate send does (assignment claim/check
    // AND an active case), inside the same transaction as the insert, so
    // neither can be raced against a concurrent takeover/resolve. Unlike
    // an immediate send, this only covers the CREATE step - dispatch later
    // re-validates independently against whatever is true at THAT time
    // (see scheduled-message.service.ts's `sendScheduledMessage`), since
    // the conversation's assignment/lifecycle state can legitimately
    // change any number of times before the scheduled time arrives.
    const now = toDbDate();
    let autoAssigned = false;
    const row = await tenantDb.transaction().execute(async (trx) => {
      const access = await requireSendAccess(trx, body.contactId, user.id);
      autoAssigned = access.autoAssigned;
      return trx
        .insertInto("scheduled_messages")
        .values({
          id: crypto.randomUUID(),
          contact_id: body.contactId,
          content: body.content?.trim() || "",
          message_type: body.messageType,
          media_url: body.mediaUrl || null,
          media_mime_type: mediaMimeType,
          media_file_name: mediaFileName,
          reply_to_message_id: body.replyToMessageId || null,
          scheduled_at: scheduledAt,
          status: "scheduled",
          attempts: 0,
          next_attempt_at: scheduledAt,
          created_by: user.id,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    if (autoAssigned) {
      await broadcastAutoAssignment(tenantDb, companyId, body.contactId, user.id);
    }

    const scheduledMessage = formatScheduledMessage(
      row as ScheduledMessageRow,
      user.name || user.email.split("@")[0],
    );

    await broadcastToCompany(companyId, "scheduled_message:updated", {
      scheduledMessageId: row.id,
      conversationId: body.contactId,
      status: "scheduled",
    });

    return c.json({
      success: true,
      scheduledMessage,
      autoAssigned,
    });
  },
);

/**
 * GET /scheduled?contactId= - List a conversation's scheduled messages
 * Returns upcoming and failed entries; sent/canceled rows are history and
 * excluded. Contact visibility rules apply.
 */
scheduledRoutes.get(
  "/scheduled",
  zValidator("query", listScheduledMessagesQuerySchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const { contactId } = c.req.valid("query");

    if (!(await hasContactVisibility(c, contactId))) {
      return notFound(c, "Contact");
    }

    const rows = await tenantDb
      .selectFrom("scheduled_messages")
      .selectAll()
      .where("contact_id", "=", contactId)
      .where("status", "in", ["scheduled", "processing", "failed"])
      .orderBy("scheduled_at", "asc")
      .limit(100)
      .execute();

    const names = await getUserNames(rows.map((row) => row.created_by));
    return c.json({
      success: true,
      scheduledMessages: rows.map((row) =>
        formatScheduledMessage(
          row as ScheduledMessageRow,
          names.get(row.created_by),
        ),
      ),
    });
  },
);

/**
 * DELETE /scheduled/:id - Cancel a scheduled message
 * Only rows that have not started dispatching (or already failed) can be
 * canceled; a row being processed is past the point of no return.
 */
scheduledRoutes.delete(
  "/scheduled/:id",
  requireMessageSendPermission,
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const id = c.req.param("id");

    const row = await tenantDb
      .selectFrom("scheduled_messages")
      .select(["id", "contact_id", "status", "media_url", "bulk_job_id"])
      .where("id", "=", id)
      .executeTakeFirst();

    if (!row || !(await hasContactVisibility(c, row.contact_id))) {
      return notFound(c, "Scheduled message");
    }

    const result = await tenantDb
      .updateTable("scheduled_messages")
      .set({
        status: "canceled",
        canceled_by: user.id,
        canceled_at: toDbDate(),
        updated_at: toDbDate(),
      })
      .where("id", "=", id)
      .where("status", "in", ["scheduled", "failed"])
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      return badRequest(
        c,
        "This message is already being sent and can no longer be canceled",
      );
    }

    if (row.bulk_job_id) {
      // Bulk media is shared by the job's other leaves; only job finalization
      // may reclaim it. Canceling one leaf can also be the job's last word.
      await finalizeBulkJobIfComplete(tenantDb, companyId, row.bulk_job_id);
    } else {
      // A canceled schedule is this media object's only consumer; reclaim it.
      await cleanupScheduledMediaObject(tenantDb, companyId, id, row.media_url);
    }

    await broadcastToCompany(companyId, "scheduled_message:updated", {
      scheduledMessageId: id,
      conversationId: row.contact_id,
      status: "canceled",
    });

    return c.json({ success: true });
  },
);
