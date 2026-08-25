import {
  extractPhoneFromJid,
  getGroupDisplayName,
  normalizeJid,
} from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

export interface ListGroupsOptions {
  search?: string;
  connectionId?: string;
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
  /**
   * False once this WhatsApp account left the group. The conversation is kept
   * as a record - WhatsApp has no way to delete a group - but no
   * administration action is possible on it any more.
   */
  isMember: boolean;
}

/**
 * The group permissions WhatsApp exposes, as last confirmed by WhatsApp.
 *
 * These are read-only projections. They change when the worker reports a new
 * snapshot, never when a settings request is accepted by the API.
 */
export interface GroupSettings {
  ownerJid: string | null;
  /** Only admins may send messages. */
  isAnnounce: boolean;
  /** Only admins may edit the group's name, icon and description. */
  isLocked: boolean;
  /** Disappearing messages are on. */
  isEphemeral: boolean;
  /** Disappearing-message timer in seconds; 0 when off. */
  disappearingTimer: number;
  /** New members need admin approval. */
  isJoinApprovalRequired: boolean;
  /** `admin_add` or `all_member_add`. */
  memberAddMode: string | null;
  isMember: boolean;
  /** When WhatsApp last confirmed all of the above. */
  syncedAt: Date | null;
}

export interface EnrichedGroupParticipant {
  jid: string;
  phoneNumber: string | null;
  /** Raw WhatsApp mention tokens, including LIDs mapped to this participant. */
  mentionIds: string[];
  displayName: string;
  profilePictureUrl: string | null;
  isAdmin: boolean;
  isSelf: boolean;
  joinedAt: Date;
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
  const { search, connectionId, limit, offset, userId, canViewAllChats } =
    options;
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
      "groups.is_member",
      "message_summary.last_message_at",
    ])
    .select((eb) =>
      eb.fn
        .coalesce("conversation_states.unread_count", eb.val(0))
        .as("unread_count"),
    )
    .where("contacts.is_group", "=", true);

  if (connectionId) {
    query = query.where("contacts.whatsapp_connection_id", "=", connectionId);
  }

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
    // PostgreSQL puts NULL values first for DESC unless explicitly told not
    // to. That made groups without messages appear above active groups.
    .orderBy(sql`message_summary.last_message_at DESC NULLS LAST`)
    .orderBy("contacts.id", "asc")
    .limit(limit)
    .offset(offset)
    .execute();

  let countQuery = tenantDb
    .selectFrom("contacts")
    .leftJoin("groups", "groups.contact_id", "contacts.id")
    .select((eb) => eb.fn.count("contacts.id").as("total"))
    .where("contacts.is_group", "=", true);

  if (connectionId) {
    countQuery = countQuery.where(
      "contacts.whatsapp_connection_id",
      "=",
      connectionId,
    );
  }

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
        // A conversation with no `groups` row has not synced yet; treat it as
        // joined rather than as one this account has left.
        isMember: group.is_member ?? true,
      };
    }),
    total: Number(countResult?.total || 0),
  };
}

/** Resolve group members to the same names and avatars shown in message bubbles. */
export async function getEnrichedGroupParticipants(
  tenantDb: Kysely<TenantDatabase>,
  options: {
    groupId: string;
    contactId: string;
    connectionId: string | null;
    connectionJid: string | null;
  },
): Promise<EnrichedGroupParticipant[]> {
  const participantRows = await tenantDb
    .selectFrom("group_participants")
    .select(["participant_jid", "is_admin", "joined_at"])
    .where("group_id", "=", options.groupId)
    .execute();
  if (participantRows.length === 0) return [];

  const participantJids = [
    ...new Set(
      participantRows
        .map((participant) => normalizeJid(participant.participant_jid))
        .filter((jid): jid is string => Boolean(jid)),
    ),
  ];
  if (participantJids.length === 0) return [];

  const [contacts, messageSenders, storedNames, lidMappings] =
    await Promise.all([
      options.connectionId
        ? tenantDb
            .selectFrom("contacts")
            .select(["jid", "custom_name", "push_name", "profile_picture_url"])
            .where("whatsapp_connection_id", "=", options.connectionId)
            .where("jid", "in", participantJids)
            .execute()
        : Promise.resolve([]),
      tenantDb
        .selectFrom("messages")
        .select(["sender_jid", "sender_name", "sender_avatar_url", "timestamp"])
        .where("contact_id", "=", options.contactId)
        .where("sender_jid", "in", participantJids)
        .orderBy("timestamp", "desc")
        .execute(),
      options.connectionId
        ? sql<{ jid: string; name: string | null }>`
          SELECT DISTINCT ON (normalized_jid)
            normalized_jid AS jid,
            coalesce(
              nullif(stored.full_name, ''),
              nullif(stored.push_name, ''),
              nullif(stored.first_name, ''),
              nullif(stored.business_name, '')
            ) AS name
          FROM (
            SELECT
              contacts.*,
              regexp_replace(
                coalesce(mapping.jid, contacts.their_jid),
                ':[0-9]+@',
                '@'
              ) AS normalized_jid
            FROM whatsapp_sessions.whatsmeow_contacts AS contacts
            LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS mapping
              ON mapping.connection_id::text = contacts.connection_id::text
              AND regexp_replace(mapping.lid, ':[0-9]+@', '@') =
                  regexp_replace(contacts.their_jid, ':[0-9]+@', '@')
            WHERE contacts.connection_id::text = ${options.connectionId}
          ) AS stored
          WHERE normalized_jid IN (${sql.join(
            participantJids.map((jid) => sql`${jid}`),
          )})
          ORDER BY normalized_jid
        `.execute(tenantDb)
        : Promise.resolve({ rows: [] }),
      options.connectionId
        ? sql<{ jid: string; lid: string }>`
          SELECT mapping.jid, mapping.lid
          FROM whatsapp_sessions.whatsmeow_lid_mappings AS mapping
          WHERE mapping.connection_id = ${options.connectionId}
            AND mapping.jid IN (${sql.join(
              participantJids.map((jid) => sql`${jid}`),
            )})
        `.execute(tenantDb)
        : Promise.resolve({ rows: [] }),
    ]);

  const contactByJid = new Map(
    contacts.map((contact) => [contact.jid, contact]),
  );
  const senderByJid = new Map<
    string,
    { sender_name: string | null; sender_avatar_url: string | null }
  >();
  for (const sender of messageSenders) {
    const jid = normalizeJid(sender.sender_jid);
    if (jid && !senderByJid.has(jid)) senderByJid.set(jid, sender);
  }
  const storedNameByJid = new Map(
    storedNames.rows.map((stored) => [stored.jid, stored.name]),
  );
  const mentionIdsByJid = new Map<string, Set<string>>();
  for (const mapping of lidMappings.rows) {
    const jid = normalizeJid(mapping.jid);
    const mentionId = normalizeJid(mapping.lid)?.split("@")[0];
    if (!jid || !mentionId) continue;
    const ids = mentionIdsByJid.get(jid) ?? new Set<string>();
    ids.add(mentionId);
    mentionIdsByJid.set(jid, ids);
  }
  const ownJid = normalizeJid(options.connectionJid);

  return participantRows
    .map((participant) => {
      const jid = normalizeJid(participant.participant_jid);
      if (!jid) return null;
      const contact = contactByJid.get(jid);
      const sender = senderByJid.get(jid);
      const phoneNumber = jid.endsWith("@s.whatsapp.net")
        ? extractPhoneFromJid(jid)
        : null;
      const displayName =
        contact?.custom_name ||
        contact?.push_name ||
        storedNameByJid.get(jid) ||
        sender?.sender_name ||
        (phoneNumber ? `+${phoneNumber}` : jid.split("@")[0]) ||
        "Unknown participant";

      const mentionIds = new Set(mentionIdsByJid.get(jid));
      const jidMentionId = jid.split("@")[0];
      if (jidMentionId) mentionIds.add(jidMentionId);
      if (phoneNumber) mentionIds.add(phoneNumber);

      return {
        jid,
        phoneNumber,
        mentionIds: [...mentionIds],
        displayName,
        profilePictureUrl:
          contact?.profile_picture_url || sender?.sender_avatar_url || null,
        isAdmin: participant.is_admin,
        isSelf: jid === ownJid,
        joinedAt: participant.joined_at,
      };
    })
    .filter(
      (participant): participant is EnrichedGroupParticipant =>
        participant !== null,
    )
    .sort(
      (left, right) =>
        Number(right.isSelf) - Number(left.isSelf) ||
        Number(right.isAdmin) - Number(left.isAdmin) ||
        left.displayName.localeCompare(right.displayName),
    );
}
