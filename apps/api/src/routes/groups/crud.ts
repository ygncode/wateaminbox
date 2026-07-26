/**
 * Group CRUD Routes
 *
 * Routes for listing, getting, and updating groups.
 */
import { zValidator } from "@hono/zod-validator";
import { getGroupDisplayName, toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.js";
import { successData, successPaginated } from "../../lib/response.js";
import {
  listGroupsQuerySchema,
  updateGroupSchema,
} from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { getGroupsList } from "../../services/group.service.js";

export const crudRoutes = new Hono();

/**
 * GET / - List all groups
 * Query params: search, limit, offset
 */
crudRoutes.get("/", zValidator("query", listGroupsQuerySchema), async (c) => {
  const { tenantDb, user, permissions } = getRouteContext(c);
  const { search, limit, offset } = c.req.valid("query");

  const { groups, total } = await getGroupsList(tenantDb, {
    search,
    limit,
    offset,
    userId: user.id,
    canViewAllChats: permissions.can_view_all_chats,
  });

  return successPaginated(c, groups, {
    total,
    limit,
    offset,
    hasMore: offset + groups.length < total,
  });
});

/**
 * GET /:id - Get a specific group with participants
 */
crudRoutes.get("/:id", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Get contact (group)
  const contact = await tenantDb
    .selectFrom("contacts")
    .selectAll()
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Group");
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

  return successData(c, {
    id: contact.id,
    jid: contact.jid,
    name: contact.custom_name || group?.name || contact.push_name,
    displayName: getGroupDisplayName({
      custom_name: contact.custom_name,
      name: group?.name || contact.push_name,
    }),
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
 * PATCH /:id - Update group custom name
 */
crudRoutes.patch("/:id", zValidator("json", updateGroupSchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const { customName } = c.req.valid("json");

  const updated = await tenantDb
    .updateTable("contacts")
    .set({
      custom_name: customName,
      updated_at: toDbDate(),
    })
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .returning(["id", "custom_name", "updated_at"])
    .executeTakeFirst();

  if (!updated) {
    return notFound(c, "Group");
  }

  return successData(c, {
    id: updated.id,
    customName: updated.custom_name,
    updatedAt: updated.updated_at,
  });
});
