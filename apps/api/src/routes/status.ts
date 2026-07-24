import { now, toDbDate, toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { forbidden, notFound } from "../lib/errors.js";
import {
  successData,
  successPaginated,
  successMessage,
  created,
} from "../lib/response.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import {
  extractPaginationParams,
  createPaginationMeta,
} from "../lib/route-helpers.js";
import { postStatusSchema } from "../lib/schemas/index.js";
import { enqueueConnectionCommand } from "../services/command-outbox.service.js";
import { env } from "../lib/env.js";
import { getActiveWhatsAppConnection } from "../services/whatsapp-connection.service.js";

export const statusRoutes = new Hono();

// All status routes require authentication and tenant context
statusRoutes.use("/*", authMiddleware);
statusRoutes.use("/*", tenantMiddleware());

/**
 * GET /status - List all status updates (not expired)
 * Query params: limit, offset
 */
statusRoutes.get("/", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const { limit, offset } = extractPaginationParams(c);

  const currentTime = toDbDate();

  // Get non-expired status updates
  const statuses = await tenantDb
    .selectFrom("status_updates")
    .selectAll()
    .where("expires_at", ">", currentTime)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  // Group statuses by sender
  const groupedByContact: Record<string, typeof statuses> = {};
  for (const status of statuses) {
    const jid = status.from_jid || "unknown";
    if (!groupedByContact[jid]) {
      groupedByContact[jid] = [];
    }
    groupedByContact[jid].push(status);
  }

  // Transform to contact-grouped format
  const contacts = Object.entries(groupedByContact).map(
    ([jid, contactStatuses]) => ({
      jid,
      statuses: contactStatuses.map((s) => ({
        id: s.id,
        statusId: s.status_id,
        mediaType: s.media_type,
        mediaUrl: s.media_url,
        caption: s.caption,
        timestamp: s.timestamp,
        expiresAt: s.expires_at,
      })),
    }),
  );

  // Get total count
  const countResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.countAll().as("total"))
    .where("expires_at", ">", currentTime)
    .executeTakeFirst();
  const total = Number(countResult?.total || 0);

  return successPaginated(
    c,
    contacts,
    createPaginationMeta(total, statuses.length, { limit, offset }),
  );
});

/**
 * GET /status/:jid - Get all status updates from a specific contact
 */
statusRoutes.get("/:jid", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const jid = c.req.param("jid");
  const currentTime = toDbDate();

  const statuses = await tenantDb
    .selectFrom("status_updates")
    .selectAll()
    .where("from_jid", "=", jid)
    .where("expires_at", ">", currentTime)
    .orderBy("timestamp", "asc")
    .execute();

  if (statuses.length === 0) {
    return notFound(c, "Status updates");
  }

  return successData(c, {
    jid,
    statuses: statuses.map((s) => ({
      id: s.id,
      statusId: s.status_id,
      mediaType: s.media_type,
      mediaUrl: s.media_url,
      caption: s.caption,
      timestamp: s.timestamp,
      expiresAt: s.expires_at,
    })),
  });
});

/**
 * GET /status/stats - Get status statistics
 */
statusRoutes.get("/stats/overview", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const currentTime = toDbDate();

  // Get active status count
  const activeResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("expires_at", ">", currentTime)
    .executeTakeFirst();

  // Get unique contacts with status
  const contactsResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.count("from_jid").distinct().as("count"))
    .where("expires_at", ">", currentTime)
    .executeTakeFirst();

  // Get total status ever received
  const totalResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.countAll().as("count"))
    .executeTakeFirst();

  return successData(c, {
    activeStatuses: Number(activeResult?.count || 0),
    contactsWithStatus: Number(contactsResult?.count || 0),
    totalStatusesReceived: Number(totalResult?.count || 0),
  });
});

/**
 * POST /status - Post a new status update
 * Body: { type: "text" | "image" | "video", content?: string, mediaUrl?: string }
 */
statusRoutes.post("/", zValidator("json", postStatusSchema), async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const { type, content, mediaUrl } = c.req.valid("json");

  // Get the WhatsApp connection to verify it's active (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(tenantDb);

  // Get the JID for the connection
  const connectionDetails = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["jid"])
    .where("id", "=", connection.id)
    .executeTakeFirst();

  // Create status record with pending state
  if (mediaUrl) {
    const allowedOrigin = new URL(env.S3_ENDPOINT).origin;
    if (new URL(mediaUrl).origin !== allowedOrigin) {
      return forbidden(c, "Status media must come from configured storage");
    }
  }

  const statusId = crypto.randomUUID();
  const currentTime = now();
  const expiresAt = currentTime.add(24, "hour");

  await tenantDb.transaction().execute(async (trx) => {
    await trx
      .insertInto("status_updates")
      .values({
        id: statusId,
        whatsapp_connection_id: connection.id,
        status_id: `pending_${statusId}`,
        from_jid: connectionDetails?.jid || "me",
        media_type: type === "text" ? null : type,
        media_url: mediaUrl || null,
        caption: content || null,
        timestamp: currentTime.toDate(),
        expires_at: expiresAt.toDate(),
      })
      .execute();
    await enqueueConnectionCommand(
      trx,
      companyId,
      connection.id,
      (publisher) =>
        publisher.postStatus(type, content || "", user.id, mediaUrl),
    );
  });

  return created(c, {
    id: statusId,
    type,
    content: content || null,
    mediaUrl: mediaUrl || null,
    timestamp: toISOString(currentTime),
    expiresAt: toISOString(expiresAt),
  });
});

/**
 * DELETE /status/:id - Delete a posted status
 */
statusRoutes.delete("/:id", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const statusId = c.req.param("id");

  // Get the status to verify it exists and is our own
  const status = await tenantDb
    .selectFrom("status_updates")
    .select(["id", "from_jid"])
    .where("id", "=", statusId)
    .executeTakeFirst();

  if (!status) {
    return notFound(c, "Status");
  }

  // Get our connected JID
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  // Only allow deleting our own statuses
  if (
    connection?.jid &&
    status.from_jid !== connection.jid &&
    status.from_jid !== "me"
  ) {
    return forbidden(c, "Cannot delete other users' statuses");
  }

  // Delete the status from database
  await tenantDb
    .deleteFrom("status_updates")
    .where("id", "=", statusId)
    .execute();

  return successMessage(c, "Status deleted");
});

/**
 * GET /status/my - Get my posted status updates
 */
statusRoutes.get("/my", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const currentTime = toDbDate();

  // Get connected JID
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection?.jid) {
    return successData(c, { statuses: [], count: 0 });
  }

  // Get my active statuses
  const myStatuses = await tenantDb
    .selectFrom("status_updates")
    .selectAll()
    .where((eb) =>
      eb.or([eb("from_jid", "=", connection.jid!), eb("from_jid", "=", "me")]),
    )
    .where("expires_at", ">", currentTime)
    .orderBy("timestamp", "desc")
    .execute();

  return successData(c, {
    statuses: myStatuses.map((s) => ({
      id: s.id,
      statusId: s.status_id,
      mediaType: s.media_type,
      mediaUrl: s.media_url,
      caption: s.caption,
      timestamp: s.timestamp,
      expiresAt: s.expires_at,
    })),
    count: myStatuses.length,
  });
});
