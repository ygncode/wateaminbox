import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { publishPostStatus, type StatusType } from "../lib/nats.js";

export const statusRoutes = new Hono();

// All status routes require authentication and tenant context
statusRoutes.use("/*", authMiddleware);
statusRoutes.use("/*", tenantMiddleware());

/**
 * GET /status - List all status updates (not expired)
 * Query params: limit, offset
 */
statusRoutes.get("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const now = new Date();

  // Get non-expired status updates
  const statuses = await tenantDb
    .selectFrom("status_updates")
    .selectAll()
    .where("expires_at", ">", now)
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
    .where("expires_at", ">", now)
    .executeTakeFirst();
  const total = Number(countResult?.total || 0);

  return c.json({
    data: contacts,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + statuses.length < total,
    },
  });
});

/**
 * GET /status/:jid - Get all status updates from a specific contact
 */
statusRoutes.get("/:jid", async (c) => {
  const tenantDb = c.get("tenantDb");
  const jid = c.req.param("jid");
  const now = new Date();

  const statuses = await tenantDb
    .selectFrom("status_updates")
    .selectAll()
    .where("from_jid", "=", jid)
    .where("expires_at", ">", now)
    .orderBy("timestamp", "asc")
    .execute();

  if (statuses.length === 0) {
    return c.json({ error: "No status updates found" }, 404);
  }

  return c.json({
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
  const tenantDb = c.get("tenantDb");
  const now = new Date();

  // Get active status count
  const activeResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("expires_at", ">", now)
    .executeTakeFirst();

  // Get unique contacts with status
  const contactsResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.count("from_jid").distinct().as("count"))
    .where("expires_at", ">", now)
    .executeTakeFirst();

  // Get total status ever received
  const totalResult = await tenantDb
    .selectFrom("status_updates")
    .select((eb) => eb.fn.countAll().as("count"))
    .executeTakeFirst();

  return c.json({
    activeStatuses: Number(activeResult?.count || 0),
    contactsWithStatus: Number(contactsResult?.count || 0),
    totalStatusesReceived: Number(totalResult?.count || 0),
  });
});

/**
 * POST /status - Post a new status update
 * Body: { type: "text" | "image" | "video", content?: string, mediaUrl?: string }
 */
statusRoutes.post("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const body = await c.req.json();

  const { type, content, mediaUrl } = body as {
    type: StatusType;
    content?: string;
    mediaUrl?: string;
  };

  // Validate status type
  if (!type || !["text", "image", "video"].includes(type)) {
    return c.json(
      { error: "type is required and must be 'text', 'image', or 'video'" },
      400,
    );
  }

  // Validate content for text status
  if (type === "text" && !content) {
    return c.json({ error: "content is required for text status" }, 400);
  }

  // Validate mediaUrl for image/video status
  if ((type === "image" || type === "video") && !mediaUrl) {
    return c.json(
      { error: "mediaUrl is required for image/video status" },
      400,
    );
  }

  // Get the WhatsApp connection to verify it's active
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status", "jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection) {
    return c.json(
      { error: "WhatsApp is not connected. Please connect first." },
      400,
    );
  }

  // Create status record with pending state
  const statusId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  await tenantDb
    .insertInto("status_updates")
    .values({
      id: statusId,
      whatsapp_connection_id: connection.id,
      status_id: `pending_${statusId}`,
      from_jid: connection.jid || "me",
      media_type: type === "text" ? null : type,
      media_url: mediaUrl || null,
      caption: content || null,
      timestamp: now,
      expires_at: expiresAt,
    })
    .execute();

  // Publish command to NATS for WhatsApp worker to post the status
  await publishPostStatus(companyId, type, user.id, content, mediaUrl);

  return c.json({
    success: true,
    status: {
      id: statusId,
      type,
      content: content || null,
      mediaUrl: mediaUrl || null,
      timestamp: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
});

/**
 * DELETE /status/:id - Delete a posted status
 */
statusRoutes.delete("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const statusId = c.req.param("id");

  // Get the status to verify it exists and is our own
  const status = await tenantDb
    .selectFrom("status_updates")
    .select(["id", "from_jid"])
    .where("id", "=", statusId)
    .executeTakeFirst();

  if (!status) {
    return c.json({ error: "Status not found" }, 404);
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
    return c.json({ error: "Cannot delete other users' statuses" }, 403);
  }

  // Delete the status from database
  await tenantDb
    .deleteFrom("status_updates")
    .where("id", "=", statusId)
    .execute();

  return c.json({ success: true });
});

/**
 * GET /status/my - Get my posted status updates
 */
statusRoutes.get("/my", async (c) => {
  const tenantDb = c.get("tenantDb");
  const now = new Date();

  // Get connected JID
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection?.jid) {
    return c.json({ data: [], count: 0 });
  }

  // Get my active statuses
  const myStatuses = await tenantDb
    .selectFrom("status_updates")
    .selectAll()
    .where((eb) =>
      eb.or([eb("from_jid", "=", connection.jid!), eb("from_jid", "=", "me")]),
    )
    .where("expires_at", ">", now)
    .orderBy("timestamp", "desc")
    .execute();

  return c.json({
    data: myStatuses.map((s) => ({
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
