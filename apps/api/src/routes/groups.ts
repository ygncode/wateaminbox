import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";

export const groupRoutes = new Hono();

// All group routes require authentication and tenant context
groupRoutes.use("/*", authMiddleware);
groupRoutes.use("/*", tenantMiddleware());

/**
 * GET /groups - List all groups
 * Query params: search, limit, offset
 */
groupRoutes.get("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const search = c.req.query("search");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  let query = tenantDb
    .selectFrom("contacts")
    .leftJoin("groups", "groups.contact_id", "contacts.id")
    .leftJoin("messages", "messages.contact_id", "contacts.id")
    .select([
      "contacts.id",
      "contacts.jid",
      "contacts.custom_name",
      "contacts.profile_picture_url",
      "contacts.created_at",
      "groups.name as group_name",
      "groups.description",
      "groups.participant_count",
    ])
    .select((eb) => [
      eb.fn.max("messages.timestamp").as("last_message_at"),
      eb.fn
        .count("messages.id")
        .filterWhere("messages.from_me", "=", false)
        .as("unread_count"),
    ])
    .where("contacts.is_group", "=", true)
    .groupBy(["contacts.id", "groups.id"]);

  // Filter by search term
  if (search) {
    query = query.where((eb) =>
      eb.or([
        eb("contacts.custom_name", "ilike", `%${search}%`),
        eb("groups.name", "ilike", `%${search}%`),
      ]),
    );
  }

  // Order by last message time
  query = query.orderBy("last_message_at", "desc");

  // Pagination
  const groups = await query.limit(limit).offset(offset).execute();

  // Get total count
  let countQuery = tenantDb
    .selectFrom("contacts")
    .select((eb) => eb.fn.count("id").as("total"))
    .where("is_group", "=", true);

  if (search) {
    countQuery = countQuery.where("custom_name", "ilike", `%${search}%`);
  }

  const countResult = await countQuery.executeTakeFirst();
  const total = Number(countResult?.total || 0);

  return c.json({
    data: groups.map((group) => ({
      id: group.id,
      jid: group.jid,
      name: group.custom_name || group.group_name,
      displayName: group.custom_name || group.group_name || "Unknown Group",
      description: group.description,
      participantCount: group.participant_count,
      profilePictureUrl: group.profile_picture_url,
      lastMessageAt: group.last_message_at,
      unreadCount: Number(group.unread_count),
      createdAt: group.created_at,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + groups.length < total,
    },
  });
});

/**
 * GET /groups/:id - Get a specific group with participants
 */
groupRoutes.get("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");

  // Get contact (group)
  const contact = await tenantDb
    .selectFrom("contacts")
    .selectAll()
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Group not found" }, 404);
  }

  // Get group info
  const group = await tenantDb
    .selectFrom("groups")
    .selectAll()
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  // Get participants
  const participants = group
    ? await tenantDb
        .selectFrom("group_participants")
        .select(["participant_jid", "is_admin", "joined_at"])
        .where("group_id", "=", group.id)
        .orderBy("is_admin", "desc")
        .orderBy("joined_at", "asc")
        .execute()
    : [];

  // Get tags
  const tags = await tenantDb
    .selectFrom("contact_tags")
    .innerJoin("tags", "tags.id", "contact_tags.tag_id")
    .select(["tags.id", "tags.name", "tags.color"])
    .where("contact_tags.contact_id", "=", contactId)
    .execute();

  return c.json({
    id: contact.id,
    jid: contact.jid,
    name: contact.custom_name || group?.name,
    displayName: contact.custom_name || group?.name || "Unknown Group",
    customName: contact.custom_name,
    description: group?.description,
    profilePictureUrl: contact.profile_picture_url,
    participantCount: group?.participant_count || 0,
    createdBy: group?.created_by,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    participants: participants.map((p) => ({
      jid: p.participant_jid,
      isAdmin: p.is_admin,
      joinedAt: p.joined_at,
    })),
    tags,
  });
});

/**
 * PATCH /groups/:id - Update group custom name
 */
groupRoutes.patch("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { customName } = body;

  const updated = await tenantDb
    .updateTable("contacts")
    .set({
      custom_name: customName,
      updated_at: new Date(),
    })
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .returning(["id", "custom_name", "updated_at"])
    .executeTakeFirst();

  if (!updated) {
    return c.json({ error: "Group not found" }, 404);
  }

  return c.json({
    id: updated.id,
    customName: updated.custom_name,
    updatedAt: updated.updated_at,
  });
});
