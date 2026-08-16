/**
 * Group CRUD Routes
 *
 * Listing, reading, creating, and renaming the workspace-local label.
 *
 * `PATCH /:id` changes `contacts.custom_name`, which is a workspace-only alias
 * and is written directly - it never leaves the workspace. Changing the group's
 * real WhatsApp name is `PATCH /:id/settings` and goes through WhatsApp.
 *
 * There is no delete route. WhatsApp has no delete/disband operation for
 * groups; `POST /:id/leave` ends this account's membership instead.
 */
import { zValidator } from "@hono/zod-validator";
import {
  GROUP_LEAVE_SEMANTICS,
  getGroupDisplayName,
  toDbDate,
} from "@wateaminbox/shared";
import { Hono } from "hono";
import { conflict, notFound } from "../../lib/errors.js";
import {
  successData,
  successPaginated,
  successWithMessage,
} from "../../lib/response.js";
import {
  createGroupSchema,
  listGroupsQuerySchema,
  updateGroupSchema,
} from "../../lib/schemas/index.js";
import { getAuthorizedMediaUrlOrNull } from "../../lib/storage.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import {
  type GroupSettings,
  getEnrichedGroupParticipants,
  getGroupsList,
} from "../../services/group.service.js";

export const crudRoutes = new Hono();

/**
 * GET / - List all groups
 * Query params: search, connectionId, limit, offset
 */
crudRoutes.get("/", zValidator("query", listGroupsQuerySchema), async (c) => {
  const { tenantDb, user, permissions, companyId } = getRouteContext(c);
  const { search, connectionId, limit, offset } = c.req.valid("query");

  const { groups, total } = await getGroupsList(tenantDb, {
    search,
    connectionId,
    limit,
    offset,
    userId: user.id,
    canViewAllChats: permissions.can_view_all_chats,
  });

  const authorizedGroups = await Promise.all(
    groups.map(async (group) => ({
      ...group,
      profilePictureUrl: await getAuthorizedMediaUrlOrNull(
        group.profilePictureUrl,
        companyId,
      ),
    })),
  );
  return successPaginated(c, authorizedGroups, {
    total,
    limit,
    offset,
    hasMore: offset + authorizedGroups.length < total,
  });
});

/**
 * POST / - Create a WhatsApp group
 *
 * Returns immediately with `pending: true`. The group does not exist in the
 * workspace until WhatsApp confirms it and the worker reports it back, so no
 * contact or group row is created here.
 */
crudRoutes.post("/", zValidator("json", createGroupSchema), async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c);
  const { connectionId, name, participantJids } = c.req.valid("json");

  // Creating a group acts as one specific WhatsApp account, so the caller
  // chooses it explicitly. Ownership is implicit in the tenant-scoped read;
  // status is not, and a queued command would sit unrun without this check.
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status", "archived_at"])
    .where("id", "=", connectionId)
    .executeTakeFirst();

  if (!connection || connection.archived_at !== null) {
    return notFound(c, "WhatsApp connection");
  }
  if (connection.status !== "connected") {
    return conflict(c, "The selected WhatsApp account is not connected");
  }

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(trx, companyId, connection.id, (publisher) =>
      publisher.groupCreate(name, participantJids, user.id),
    );
  });

  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.updated",
    entityType: "group",
    entityId: connection.id,
    details: {
      connectionId: connection.id,
      groupName: name,
      participantJids,
      operation: "create_group",
    },
    ipAddress: getClientIp(c),
  });

  return successWithMessage(
    c,
    "Requested from WhatsApp. The group appears once WhatsApp confirms it.",
    { pending: true, name, participantJids, connectionId: connection.id },
  );
});

/**
 * GET /:id - Get a specific group with participants
 */
crudRoutes.get("/:id", async (c) => {
  const { tenantDb, companyId, permissions } = getRouteContext(c);
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

  const connection = contact.whatsapp_connection_id
    ? await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "jid", "name", "phone_number", "status"])
        .where("id", "=", contact.whatsapp_connection_id)
        .executeTakeFirst()
    : null;

  // Resolve every member to a saved WhatsApp/contact name when possible. Phone
  // numbers remain available as the privacy-safe fallback.
  const participants = group
    ? await getEnrichedGroupParticipants(tenantDb, {
        groupId: group.id,
        contactId,
        connectionId: contact.whatsapp_connection_id,
        connectionJid: connection?.jid ?? null,
      })
    : [];

  // Get tags
  const tags = await tenantDb
    .selectFrom("contact_tags")
    .innerJoin("tags", "tags.id", "contact_tags.tag_id")
    .select(["tags.id", "tags.name", "tags.color"])
    .where("contact_tags.contact_id", "=", contactId)
    .execute();

  const authorizedParticipants = await Promise.all(
    participants.map(async (participant) => ({
      ...participant,
      profilePictureUrl: await getAuthorizedMediaUrlOrNull(
        participant.profilePictureUrl,
        companyId,
      ),
    })),
  );

  const isAdmin = authorizedParticipants.some(
    (participant) => participant.isSelf && participant.isAdmin,
  );
  const isMember = group?.is_member ?? true;
  // An invite link lets anyone holding it request to join, so reading one is an
  // outbound capability, not a detail view. `isAdmin` above describes the
  // WhatsApp ACCOUNT; this is about the person making the request.
  const canReadInviteLink =
    isAdmin && isMember && permissions.can_send_messages;

  // Typed against the service contract so a column added to `groups` cannot
  // quietly go missing from what clients read.
  const settings: GroupSettings = {
    ownerJid: group?.owner_jid ?? null,
    isAnnounce: group?.is_announce ?? false,
    isLocked: group?.is_locked ?? false,
    isEphemeral: group?.is_ephemeral ?? false,
    disappearingTimer: group?.disappearing_timer ?? 0,
    isJoinApprovalRequired: group?.is_join_approval_required ?? false,
    memberAddMode: group?.member_add_mode ?? null,
    isMember,
    syncedAt: group?.metadata_synced_at ?? null,
  };

  return successData(c, {
    id: contact.id,
    jid: contact.jid,
    name: contact.custom_name || group?.name || contact.push_name,
    displayName: getGroupDisplayName({
      custom_name: contact.custom_name,
      name: group?.name || contact.push_name,
    }),
    customName: contact.custom_name,
    // `name` above is alias-first, so it is a display label rather than the
    // group's real subject. Anything that WRITES the name back to WhatsApp has
    // to use this instead - sending the workspace-private alias would rename
    // the group for every member.
    whatsappName: group?.name ?? null,
    description: group?.description,
    profilePictureUrl: await getAuthorizedMediaUrlOrNull(
      contact.profile_picture_url,
      companyId,
    ),
    participantCount: Math.max(
      group?.participant_count || 0,
      authorizedParticipants.length,
    ),
    createdBy: group?.created_by,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    participants: authorizedParticipants,
    tags,
    connection: connection
      ? {
          id: connection.id,
          name: connection.name,
          phoneNumber: connection.phone_number,
          status: connection.status,
        }
      : null,
    // What this account may do here, so the UI can disable rather than let an
    // action fail. WhatsApp remains the authority; these mirror its last
    // confirmed answer.
    isAdmin,
    isMember,
    canAdminister: isAdmin && isMember && connection?.status === "connected",
    settings,
    inviteLink: canReadInviteLink ? (group?.invite_link ?? null) : null,
    inviteLinkUpdatedAt: canReadInviteLink
      ? (group?.invite_link_updated_at ?? null)
      : null,
    /** Stated explicitly so no client infers a delete action that cannot exist. */
    leaveSemantics: GROUP_LEAVE_SEMANTICS,
  });
});

/**
 * PATCH /:id - Update the workspace-local group alias
 *
 * `customName` is this workspace's own label for the conversation. It is not
 * sent to WhatsApp and does not change the group's real name, which is why it
 * is written directly instead of going through a command.
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
