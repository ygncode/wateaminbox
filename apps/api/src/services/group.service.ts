import { getGroupDisplayName } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

export interface ListGroupsOptions {
  search?: string;
  limit: number;
  offset: number;
  userId: string;
  canViewAllChats: boolean;
}

export interface GroupListItem {
  id: string;
  jid: string | null;
  name: string | null;
  displayName: string;
  description: string | null;
  participantCount: number | null;
  profilePictureUrl: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  createdAt: Date;
}

/**
 * Return the Groups-tab projection from the same conversation state used by
 * the Chats tab. Historical message totals are deliberately not used as unread
 * counts: conversation_states is the single source of truth for that value.
 */
export async function getGroupsList(
  tenantDb: Kysely<TenantDatabase>,
  options: ListGroupsOptions,
): Promise<{ groups: GroupListItem[]; total: number }> {
  const { search, limit, offset, userId, canViewAllChats } = options;
  const messageSummary = tenantDb
    .selectFrom("messages")
    .select("contact_id")
    .select((eb) => eb.fn.max("timestamp").as("last_message_at"))
    .groupBy("contact_id")
    .as("message_summary");

  let query = tenantDb
    .selectFrom("contacts")
    .leftJoin("groups", "groups.contact_id", "contacts.id")
    .leftJoin(
      "conversation_states",
      "conversation_states.contact_id",
      "contacts.id",
    )
    .leftJoin(messageSummary, "message_summary.contact_id", "contacts.id")
    .select([
      "contacts.id",
      "contacts.jid",
      "contacts.custom_name",
      "contacts.push_name",
      "contacts.profile_picture_url",
      "contacts.created_at",
      "groups.name as group_name",
      "groups.description",
      "groups.participant_count",
      "message_summary.last_message_at",
    ])
    .select((eb) =>
      eb.fn
        .coalesce("conversation_states.unread_count", eb.val(0))
        .as("unread_count"),
    )
    .where("contacts.is_group", "=", true);

  if (!canViewAllChats) {
    query = query
      .innerJoin("contact_assignments", (join) =>
        join
          .onRef("contact_assignments.contact_id", "=", "contacts.id")
          .on("contact_assignments.unassigned_at", "is", null),
      )
      .where("contact_assignments.assigned_to", "=", userId);
  }

  if (search) {
    query = query.where((eb) =>
      eb.or([
        eb("contacts.custom_name", "ilike", `%${search}%`),
        eb("contacts.push_name", "ilike", `%${search}%`),
        eb("groups.name", "ilike", `%${search}%`),
      ]),
    );
  }

  const rows = await query
    .orderBy("message_summary.last_message_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  let countQuery = tenantDb
    .selectFrom("contacts")
    .leftJoin("groups", "groups.contact_id", "contacts.id")
    .select((eb) => eb.fn.count("contacts.id").as("total"))
    .where("contacts.is_group", "=", true);

  if (!canViewAllChats) {
    countQuery = countQuery
      .innerJoin("contact_assignments", (join) =>
        join
          .onRef("contact_assignments.contact_id", "=", "contacts.id")
          .on("contact_assignments.unassigned_at", "is", null),
      )
      .where("contact_assignments.assigned_to", "=", userId);
  }

  if (search) {
    countQuery = countQuery.where((eb) =>
      eb.or([
        eb("contacts.custom_name", "ilike", `%${search}%`),
        eb("contacts.push_name", "ilike", `%${search}%`),
        eb("groups.name", "ilike", `%${search}%`),
      ]),
    );
  }

  const countResult = await countQuery.executeTakeFirst();

  return {
    groups: rows.map((group) => {
      // Older syncs stored WhatsApp group titles on contacts.push_name only.
      // Keep that field in the fallback chain so existing workspaces repair
      // immediately, without requiring another history sync.
      const whatsappName = group.group_name || group.push_name;
      return {
        id: group.id,
        jid: group.jid,
        name: group.custom_name || whatsappName,
        displayName: getGroupDisplayName({
          custom_name: group.custom_name,
          group_name: whatsappName,
        }),
        description: group.description,
        participantCount:
          (group.participant_count ?? 0) > 0 ? group.participant_count : null,
        profilePictureUrl: group.profile_picture_url,
        lastMessageAt: group.last_message_at,
        unreadCount: Number(group.unread_count),
        createdAt: group.created_at,
      };
    }),
    total: Number(countResult?.total || 0),
  };
}
