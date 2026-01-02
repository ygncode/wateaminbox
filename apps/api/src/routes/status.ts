import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";

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
