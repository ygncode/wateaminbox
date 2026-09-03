import {
  extractPhoneFromJid,
  getGroupDisplayName,
  normalizeJid,
} from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";
import { fetchStoredWhatsAppNames } from "./whatsapp-stored-names.js";

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
  /**
   * The workspace contact this member resolves to on the group's own
   * connection, when one exists. Null for a member nobody has a contact record
   * for yet, which is why the client must treat the profile affordance as
   * conditional rather than assuming every member is openable.
   */
  contactId: string | null;
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
            .select([
              "id",
              "jid",
              "custom_name",
              "push_name",
              "profile_picture_url",
            ])
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
        ? fetchStoredWhatsAppNames(
            tenantDb,
            options.connectionId,
            participantJids,
          )
        : Promise.resolve(new Map<string, string>()),
      options.connectionId
        ? sql<{ jid: string; lid: string }>`
          WITH candidate_tokens AS MATERIALIZED (
            SELECT DISTINCT
              split_part(split_part(mapping.lid, '@', 1), ':', 1) AS token
            FROM whatsapp_sessions.whatsmeow_lid_mappings AS mapping
            WHERE (
              split_part(split_part(mapping.jid, '@', 1), ':', 1)
              || '@' || split_part(mapping.jid, '@', 2)
            ) IN (${sql.join(participantJids.map((jid) => sql`${jid}`))})
          ),
          relevant_mappings AS MATERIALIZED (
            SELECT
              mapping.connection_id,
              candidate.token,
              split_part(split_part(mapping.jid, '@', 1), ':', 1)
                || '@' || split_part(mapping.jid, '@', 2) AS jid
            FROM whatsapp_sessions.whatsmeow_lid_mappings AS mapping
            INNER JOIN candidate_tokens AS candidate
              ON candidate.token =
                split_part(split_part(mapping.lid, '@', 1), ':', 1)
            WHERE candidate.token ~ '^[0-9]+$'
          ),
          local_tokens AS (
            SELECT mapping.token, min(mapping.jid) AS jid
            FROM relevant_mappings AS mapping
            WHERE mapping.connection_id = ${options.connectionId}
            GROUP BY mapping.token
            HAVING count(DISTINCT mapping.jid) = 1
          ),
          globally_unambiguous_tokens AS (
            SELECT mapping.token, min(mapping.jid) AS jid
            FROM relevant_mappings AS mapping
            GROUP BY mapping.token
            HAVING count(DISTINCT mapping.jid) = 1
          ),
          safe_aliases AS (
            -- A locally unique token remains authoritative even if another
            -- connection has conflicting historical data for that token.
            SELECT alias.jid, alias.token AS lid
            FROM local_tokens AS alias
            WHERE alias.jid IN (${sql.join(
              participantJids.map((jid) => sql`${jid}`),
            )})
            UNION
            -- WhatsApp may stop returning an old LID alias. Use another
            -- connection's observation only when the numeric token (regardless
            -- of @lid versus @hosted.lid) maps globally to one identity that is
            -- already a member of this exact group. Any local observation,
            -- including a conflicting one, suppresses this fallback.
            -- This is display-only: nothing is copied into whatsmeow's
            -- connection-owned protocol mapping store.
            SELECT alias.jid, alias.token AS lid
            FROM globally_unambiguous_tokens AS alias
            WHERE alias.jid IN (${sql.join(
              participantJids.map((jid) => sql`${jid}`),
            )})
              AND NOT EXISTS (
                SELECT 1
                FROM relevant_mappings AS local_mapping
                WHERE local_mapping.connection_id = ${options.connectionId}
                  AND local_mapping.token = alias.token
              )
          )
          SELECT jid, lid FROM safe_aliases
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
  const storedNameByJid = storedNames;
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
        // Only the contact record on this group's own connection: the same
        // number reached through a different connection is a different
        // conversation, and opening that one would show the wrong history.
        contactId: contact?.id ?? null,
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
