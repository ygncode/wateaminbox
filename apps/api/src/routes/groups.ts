import { Hono } from "hono";
import type { Kysely } from "kysely";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import type { TenantDatabase } from "../services/tenant.service.js";
import {
  publishGroupPromoteAdmin,
  publishGroupDemoteAdmin,
  publishGroupRemoveParticipant,
  publishGroupUpdateSettings,
} from "../lib/nats.js";
import { createAuditLog, getClientIp } from "../services/audit.service.js";

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

/**
 * Helper function to check if current user is a group admin
 */
async function isUserGroupAdmin(
  tenantDb: Kysely<TenantDatabase>,
  groupId: string,
  userJid: string | null,
): Promise<boolean> {
  if (!userJid) return false;

  // Get the group from contacts to get the actual group table entry
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", groupId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact) return false;

  // Get group ID from groups table
  const group = await tenantDb
    .selectFrom("groups")
    .select(["id"])
    .where("contact_id", "=", groupId)
    .executeTakeFirst();

  if (!group) return false;

  // Check if user is admin in this group
  const participant = await tenantDb
    .selectFrom("group_participants")
    .select(["is_admin"])
    .where("group_id", "=", group.id)
    .where("participant_jid", "=", userJid)
    .executeTakeFirst();

  return participant?.is_admin ?? false;
}

/**
 * Helper function to get the WhatsApp JID of the current connection
 */
async function getConnectionJid(
  tenantDb: Kysely<TenantDatabase>,
): Promise<string | null> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  return connection?.jid ?? null;
}

/**
 * POST /groups/:id/participants/:participantJid/promote - Promote participant to admin
 */
groupRoutes.post("/:id/participants/:participantJid/promote", async (c) => {
  const tenantDb = c.get("tenantDb");
  const companyId = c.get("companyId");
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const userId = user.id;
  const contactId = c.req.param("id");
  const participantJid = c.req.param("participantJid");

  // Get group contact
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (!contact.whatsapp_connection_id) {
    return c.json({ error: "Group is not associated with any WhatsApp connection" }, 400);
  }

  // Get group details
  const group = await tenantDb
    .selectFrom("groups")
    .select(["id", "name"])
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!group) {
    return c.json({ error: "Group details not found" }, 404);
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb);
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

  if (!isAdmin) {
    return c.json({ error: "Only group admins can promote participants" }, 403);
  }

  // Check if participant exists in group
  const participant = await tenantDb
    .selectFrom("group_participants")
    .select(["id", "is_admin"])
    .where("group_id", "=", group.id)
    .where("participant_jid", "=", participantJid)
    .executeTakeFirst();

  if (!participant) {
    return c.json({ error: "Participant not found in group" }, 404);
  }

  if (participant.is_admin) {
    return c.json({ error: "Participant is already an admin" }, 400);
  }

  // Update local database
  await tenantDb
    .updateTable("group_participants")
    .set({ is_admin: true })
    .where("id", "=", participant.id)
    .execute();

  // Publish NATS command to WhatsApp service
  await publishGroupPromoteAdmin(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    participantJid,
    userId,
  );

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: "contact.updated",
    entityType: "group",
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      groupName: group.name,
      participantJid,
      operation: "promote_admin",
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json({
    success: true,
    message: "Participant promoted to admin",
    participantJid,
  });
});

/**
 * POST /groups/:id/participants/:participantJid/demote - Demote admin to regular participant
 */
groupRoutes.post("/:id/participants/:participantJid/demote", async (c) => {
  const tenantDb = c.get("tenantDb");
  const companyId = c.get("companyId");
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const userId = user.id;
  const contactId = c.req.param("id");
  const participantJid = c.req.param("participantJid");

  // Get group contact
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (!contact.whatsapp_connection_id) {
    return c.json({ error: "Group is not associated with any WhatsApp connection" }, 400);
  }

  // Get group details
  const group = await tenantDb
    .selectFrom("groups")
    .select(["id", "name"])
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!group) {
    return c.json({ error: "Group details not found" }, 404);
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb);
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

  if (!isAdmin) {
    return c.json({ error: "Only group admins can demote participants" }, 403);
  }

  // Check if participant exists and is admin
  const participant = await tenantDb
    .selectFrom("group_participants")
    .select(["id", "is_admin"])
    .where("group_id", "=", group.id)
    .where("participant_jid", "=", participantJid)
    .executeTakeFirst();

  if (!participant) {
    return c.json({ error: "Participant not found in group" }, 404);
  }

  if (!participant.is_admin) {
    return c.json({ error: "Participant is not an admin" }, 400);
  }

  // Update local database
  await tenantDb
    .updateTable("group_participants")
    .set({ is_admin: false })
    .where("id", "=", participant.id)
    .execute();

  // Publish NATS command to WhatsApp service
  await publishGroupDemoteAdmin(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    participantJid,
    userId,
  );

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: "contact.updated",
    entityType: "group",
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      groupName: group.name,
      participantJid,
      operation: "demote_admin",
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json({
    success: true,
    message: "Admin demoted to regular participant",
    participantJid,
  });
});

/**
 * DELETE /groups/:id/participants/:participantJid - Remove participant from group
 */
groupRoutes.delete("/:id/participants/:participantJid", async (c) => {
  const tenantDb = c.get("tenantDb");
  const companyId = c.get("companyId");
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const userId = user.id;
  const contactId = c.req.param("id");
  const participantJid = c.req.param("participantJid");

  // Get group contact
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (!contact.whatsapp_connection_id) {
    return c.json({ error: "Group is not associated with any WhatsApp connection" }, 400);
  }

  // Get group details
  const group = await tenantDb
    .selectFrom("groups")
    .select(["id", "name", "participant_count"])
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!group) {
    return c.json({ error: "Group details not found" }, 404);
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb);
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

  if (!isAdmin) {
    return c.json({ error: "Only group admins can remove participants" }, 403);
  }

  // Check if participant exists
  const participant = await tenantDb
    .selectFrom("group_participants")
    .select(["id"])
    .where("group_id", "=", group.id)
    .where("participant_jid", "=", participantJid)
    .executeTakeFirst();

  if (!participant) {
    return c.json({ error: "Participant not found in group" }, 404);
  }

  // Cannot remove yourself
  if (participantJid === connectionJid) {
    return c.json({ error: "Cannot remove yourself from the group" }, 400);
  }

  // Remove from local database
  await tenantDb
    .deleteFrom("group_participants")
    .where("id", "=", participant.id)
    .execute();

  // Update participant count
  await tenantDb
    .updateTable("groups")
    .set({ participant_count: Math.max(0, (group.participant_count || 1) - 1) })
    .where("id", "=", group.id)
    .execute();

  // Publish NATS command to WhatsApp service
  await publishGroupRemoveParticipant(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    participantJid,
    userId,
  );

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: "contact.updated",
    entityType: "group",
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      groupName: group.name,
      participantJid,
      operation: "remove_participant",
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json({
    success: true,
    message: "Participant removed from group",
    participantJid,
  });
});

/**
 * PATCH /groups/:id/settings - Update group settings (name, description)
 */
groupRoutes.patch("/:id/settings", async (c) => {
  const tenantDb = c.get("tenantDb");
  const companyId = c.get("companyId");
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const userId = user.id;
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { name, description } = body;

  // Validate input
  if (!name && description === undefined) {
    return c.json(
      { error: "At least one of name or description is required" },
      400,
    );
  }

  // Get group contact
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (!contact.whatsapp_connection_id) {
    return c.json({ error: "Group is not associated with any WhatsApp connection" }, 400);
  }

  // Get group details
  const group = await tenantDb
    .selectFrom("groups")
    .select(["id", "name", "description"])
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!group) {
    return c.json({ error: "Group details not found" }, 404);
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb);
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

  if (!isAdmin) {
    return c.json(
      { error: "Only group admins can update group settings" },
      403,
    );
  }

  // Build update object
  const updates: { name?: string; description?: string } = {};
  if (name !== undefined) {
    updates.name = name;
  }
  if (description !== undefined) {
    updates.description = description;
  }

  // Update local database
  if (Object.keys(updates).length > 0) {
    await tenantDb
      .updateTable("groups")
      .set(updates)
      .where("id", "=", group.id)
      .execute();
  }

  // Publish NATS command to WhatsApp service
  await publishGroupUpdateSettings(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    userId,
    name,
    description,
  );

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: "contact.updated",
    entityType: "group",
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      previousName: group.name,
      previousDescription: group.description,
      newName: name,
      newDescription: description,
      operation: "update_settings",
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json({
    success: true,
    message: "Group settings updated",
    name: name ?? group.name,
    description: description ?? group.description,
  });
});

/**
 * GET /groups/:id/admin-status - Check if current user is admin of this group
 */
groupRoutes.get("/:id/admin-status", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");

  // Check if group exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Group not found" }, 404);
  }

  // Get connection JID
  const connectionJid = await getConnectionJid(tenantDb);

  if (!connectionJid) {
    return c.json({
      isAdmin: false,
      connectionJid: null,
      reason: "No active WhatsApp connection",
    });
  }

  // Check admin status
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

  return c.json({
    isAdmin,
    connectionJid,
  });
});
