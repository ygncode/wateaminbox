import { toDbDate } from "@wateaminbox/shared";
import type { Kysely, RawBuilder, SqlBool } from "kysely";
import { sql } from "kysely";
import { normalizePhoneNumber } from "../lib/schemas.js";
import { conversationIdForContact } from "./channel-workflow.service.js";
import {
  buildContactWhereClause,
  phoneSearchDigits,
} from "./helpers/contact-query-builder.js";
import { getSchemaName, type TenantDatabase } from "./tenant.service.js";
import { getUserNames } from "./user.service.js";

/**
 * Options for fetching contacts with last message
 */
export interface GetContactsWithLastMessageOptions {
  /** Search term to filter by name or phone number */
  search?: string;
  /** Maximum number of contacts to return */
  limit?: number;
  /** Number of contacts to skip */
  offset?: number;
  /** Whether to include group contacts */
  includeGroups?: boolean;
  /** Filter to conversations owned by one WhatsApp account. */
  connectionId?: string;
  /** Match contacts carrying at least one selected workspace tag. */
  tagIds?: string[];
  /** Filter to contacts assigned to the current user */
  assignedToMe?: boolean;
  /** Filter to unassigned contacts */
  unassigned?: boolean;
  /** User ID for assignment filters */
  userId?: string;
  /** Enforce assignment visibility regardless of client-provided filters. */
  restrictToAssigned?: boolean;
  /** Filter by conversation lifecycle status. "all" (or omitted) applies no filter. */
  conversationStatus?: "open" | "pending" | "resolved" | "all";
  /** Filter to conversations with unread messages. */
  unreadOnly?: boolean;
}

/**
 * Result of getContactsWithLastMessage
 * Uses camelCase to match the API response format expected by the frontend
 */
export interface ContactWithLastMessage {
  id: string;
  jid: string | null;
  phone_number: string | null;
  push_name: string | null;
  username: string | null;
  custom_name: string | null;
  is_group: boolean;
  profile_picture_url: string | null;
  notes_shared: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_to: string | null;
  last_message_at: Date | null;
  unread_count: number | bigint;
  /** Threads this customer is reachable on, including merged-away contacts. */
  chat_count: number;
  /** Every account this customer's threads run on, for the inbox filter. */
  account_ids: string[];
  conversation_status: "open" | "pending" | "resolved";
  active_case_id: string | null;
  is_online: boolean;
  last_seen: Date | null;
  connection_id: string | null;
  connection_name: string | null;
  connection_phone_number: string | null;
  connection_status: string | null;
  conversation_id: string | null;
  channel: string | null;
  provider: string | null;
  last_message: {
    id: string;
    messageId: string | null;
    fromMe: boolean;
    sentByUserId: string | null;
    sentByUserName: string | null;
    messageType: string;
    content: string | null;
    status: string;
    timestamp: Date;
  } | null;
}

/**
 * Gets contacts with their last message in a single optimized query using window functions.
 * This replaces the N+1 pattern where we fetched contacts first, then queried for each contact's last message.
 *
 * Uses ROW_NUMBER() OVER PARTITION BY to get only the most recent message per contact,
 * then joins back to get the full message details. This reduces query count from N+2 to just 2-3 queries.
 *
 * @param tenantDb - Tenant database connection
 * @param options - Query options for filtering and pagination
 * @returns Contacts with last message data and total count
 */
export async function getContactsWithLastMessage(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: GetContactsWithLastMessageOptions = {},
): Promise<{ contacts: ContactWithLastMessage[]; total: number }> {
  const {
    search,
    limit = 50,
    offset = 0,
    includeGroups = false,
    connectionId,
    tagIds,
    assignedToMe = false,
    unassigned = false,
    userId,
    restrictToAssigned = false,
    conversationStatus,
    unreadOnly = false,
  } = options;

  // Use raw SQL for the complex CTE query with window function
  // Kysely's type-safe builder has limitations with CTEs and complex joins
  // The query:
  // 1. Creates a CTE that ranks messages by timestamp per contact using ROW_NUMBER()
  // 2. Joins contacts with last messages (rank=1) and assignments
  // 3. Groups by contact to get unread counts

  // `withSchema()` qualifies Kysely query-builder calls, but raw SQL has to
  // qualify identifiers itself. The tenant schema comes from trusted middleware.
  const schemaName = getSchemaName(companyId);
  const schema = sql.ref(schemaName);

  // Build WHERE clause using helper (uses parameterized SQL to prevent injection).
  // The tag table is explicitly tenant-qualified so raw SQL never depends on
  // the connection search_path.
  const { whereClause, hasConditions: hasWhereCondition } =
    buildContactWhereClause({
      search,
      includeGroups,
      connectionId,
      tagIds,
      contactTagsTable: sql.table(`${schemaName}.contact_tags`),
      contactsTable: sql.table(`${schemaName}.contacts`),
      contactAssignmentsTable: sql.table(`${schemaName}.contact_assignments`),
      assignedToMe,
      unassigned,
      userId,
      restrictToAssigned,
      conversationStatus,
      unreadOnly,
    });

  const result = await sql<{
    id: string;
    jid: string | null;
    phone_number: string | null;
    push_name: string | null;
    username: string | null;
    custom_name: string | null;
    is_group: boolean;
    profile_picture_url: string | null;
    notes_shared: string | null;
    created_at: Date;
    updated_at: Date;
    assigned_to: string | null;
    last_message_at: Date | null;
    last_message_id: string | null;
    last_message_message_id: string | null;
    last_message_from_me: boolean | null;
    last_message_message_type: string | null;
    last_message_content: string | null;
    last_message_status: string | null;
    last_message_timestamp: Date | null;
    unread_count: string;
    chat_count: number;
    account_ids: string[] | null;
    is_online: boolean;
    last_seen: Date | null;
    connection_id: string | null;
    connection_name: string | null;
    connection_phone_number: string | null;
    connection_status: string | null;
    conversation_id: string | null;
    channel: string | null;
    provider: string | null;
    last_message_sent_by_user_id: string | null;
    conversation_status: "open" | "pending" | "resolved";
    active_case_id: string | null;
  }>`
    SELECT
      c.id,
      c.jid,
      c.phone_number,
      c.push_name,
      c.username,
      c.custom_name,
      c.is_group,
      c.profile_picture_url,
      c.notes_shared,
      c.created_at,
      c.updated_at,
      c.is_online,
      c.last_seen,
      c.whatsapp_connection_id as connection_id,
      conv.id as conversation_id,
      COALESCE(acc.channel, CASE WHEN c.whatsapp_connection_id IS NOT NULL THEN 'whatsapp' END) as channel,
      COALESCE(acc.provider, CASE WHEN c.whatsapp_connection_id IS NOT NULL THEN 'whatsapp_linked_device' END) as provider,
      wc.name as connection_name,
      wc.phone_number as connection_phone_number,
      wc.status::text as connection_status,
      ca.assigned_to,
      GREATEST(
        COALESCE(lmc.timestamp, lml.timestamp),
        grp.last_message_at
      ) as last_message_at,
      COALESCE(lmc.id, lml.id) as last_message_id,
      COALESCE(lmc.message_id, lml.message_id) as last_message_message_id,
      COALESCE(lmc.from_me, lml.from_me) as last_message_from_me,
      COALESCE(lmc.message_type, lml.message_type) as last_message_message_type,
      COALESCE(lmc.content, lml.content) as last_message_content,
      COALESCE(lmc.status, lml.status) as last_message_status,
      COALESCE(lmc.timestamp, lml.timestamp) as last_message_timestamp,
      COALESCE(lmc.sent_by_user_id, lml.sent_by_user_id)
        as last_message_sent_by_user_id,
      (COALESCE(csc.unread_count, csl.unread_count, 0)
        + COALESCE(grp.unread_count, 0))::bigint as unread_count,
      (1 + COALESCE(grp.chat_count, 0))::int as chat_count,
      ARRAY_REMOVE(
        COALESCE(grp.account_ids, ARRAY[]::uuid[])
          || ARRAY[COALESCE(acc.id, c.whatsapp_connection_id)],
        NULL
      ) as account_ids,
      COALESCE(csc.status::text, csl.status::text, 'resolved')
        as conversation_status,
      COALESCE(csc.active_case_id, csl.active_case_id) as active_case_id
    FROM ${schema}.${sql.ref("contacts")} c
    LEFT JOIN ${schema}.${sql.ref("whatsapp_connections")} wc
      ON wc.id = c.whatsapp_connection_id
    LEFT JOIN ${schema}.${sql.ref("conversations")} conv
      ON conv.legacy_contact_id = c.id
      AND conv.archived_at IS NULL
    LEFT JOIN ${schema}.${sql.ref("channel_accounts")} acc
      ON acc.id = conv.channel_account_id
    LEFT JOIN ${schema}.${sql.ref("contact_assignments")} ca
      ON ca.contact_id = c.id
      AND ca.unassigned_at IS NULL
    -- Newest message and workflow state resolved by conversation, which is
    -- what owns a thread now. The contact fallback is only for a row the
    -- spine could never bridge - a contact with no WhatsApp connection or no
    -- JID has no conversation to hang anything off, and dropping its preview
    -- would silently blank a chat.
    --
    -- Two guarded laterals rather than one with COALESCE or OR: only one side
    -- runs per row, and each can use an index. Measured on the largest
    -- workspace, this is 54ms against 40ms for the contact-anchored original,
    -- where COALESCE across both keys costs 72ms and OR cannot use either
    -- index at all - that version ran for over five minutes before it was
    -- cancelled.
    LEFT JOIN LATERAL (
      SELECT id, message_id, from_me, message_type, content, status,
             timestamp, sent_by_user_id
      FROM ${schema}.${sql.ref("messages")} m
      WHERE conv.id IS NOT NULL AND m.conversation_id = conv.id
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT 1
    ) lmc ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, message_id, from_me, message_type, content, status,
             timestamp, sent_by_user_id
      FROM ${schema}.${sql.ref("messages")} m
      WHERE conv.id IS NULL AND m.contact_id = c.id
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT 1
    ) lml ON TRUE
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} csc
      ON conv.id IS NOT NULL AND csc.conversation_id = conv.id
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} csl
      ON conv.id IS NULL AND csl.contact_id = c.id
    -- Threads belonging to contacts merged into this one. They are hidden as
    -- separate rows and reached through the chat switcher, so their unread
    -- and activity have to surface here or a reply would look dropped.
    --
    -- A lateral over the partial merge-alias index rather than wider joins:
    -- on a workspace with no merges it is an empty index probe per row, which
    -- keeps the measured plan of the surrounding query intact.
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS chat_count,
             COALESCE(
               SUM(COALESCE(mcsc.unread_count, mcsl.unread_count, 0)),
               0
             )::bigint AS unread_count,
             MAX(COALESCE(mconv.last_message_at, mcsl.last_message_at))
               AS last_message_at,
             -- Every account a merged-away thread runs on. The row stands for
             -- the customer, so narrowing the inbox to one account has to keep
             -- it when any of their threads is on that account - otherwise a
             -- customer reachable on two channels disappears from one filter.
             ARRAY_REMOVE(
               ARRAY_AGG(DISTINCT COALESCE(
                 mconv.channel_account_id, mc.whatsapp_connection_id
               )),
               NULL
             ) AS account_ids
      FROM ${schema}.${sql.ref("contacts")} mc
      LEFT JOIN ${schema}.${sql.ref("conversations")} mconv
        ON mconv.legacy_contact_id = mc.id
       AND mconv.archived_at IS NULL
      LEFT JOIN ${schema}.${sql.ref("conversation_states")} mcsc
        ON mconv.id IS NOT NULL AND mcsc.conversation_id = mconv.id
      LEFT JOIN ${schema}.${sql.ref("conversation_states")} mcsl
        ON mconv.id IS NULL AND mcsl.contact_id = mc.id
      WHERE mc.merged_into_contact_id = c.id
    ) grp ON TRUE
    ${hasWhereCondition ? sql`WHERE ${whereClause}` : sql``}
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(tenantDb);

  const rawContacts = result.rows;
  const userNames = await getUserNames(
    rawContacts
      .map((contact) => contact.last_message_sent_by_user_id)
      .filter((id): id is string => Boolean(id)),
  );

  // Transform to the expected format
  const contacts: ContactWithLastMessage[] = rawContacts.map((contact) => {
    const lastMessage =
      contact.last_message_id !== null
        ? {
            id: contact.last_message_id,
            messageId: contact.last_message_message_id,
            fromMe: contact.last_message_from_me!,
            sentByUserId: contact.last_message_sent_by_user_id,
            sentByUserName: contact.last_message_sent_by_user_id
              ? userNames.get(contact.last_message_sent_by_user_id) || null
              : null,
            messageType: contact.last_message_message_type!,
            content: contact.last_message_content,
            status: contact.last_message_status!,
            timestamp: contact.last_message_timestamp!,
          }
        : null;

    return {
      id: contact.id,
      jid: contact.jid,
      phone_number: contact.phone_number,
      push_name: contact.push_name,
      username: contact.username,
      custom_name: contact.custom_name,
      is_group: contact.is_group,
      profile_picture_url: contact.profile_picture_url,
      notes_shared: contact.notes_shared,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
      assigned_to: contact.assigned_to,
      last_message_at: contact.last_message_at,
      unread_count: BigInt(contact.unread_count),
      chat_count: Number(contact.chat_count ?? 1),
      account_ids: contact.account_ids ?? [],
      is_online: contact.is_online,
      last_seen: contact.last_seen,
      connection_id: contact.connection_id,
      connection_name: contact.connection_name,
      connection_phone_number: contact.connection_phone_number,
      connection_status: contact.connection_status,
      conversation_id: contact.conversation_id,
      channel: contact.channel,
      provider: contact.provider,
      conversation_status: contact.conversation_status,
      active_case_id: contact.active_case_id,
      last_message: lastMessage,
    };
  });

  // Get total count with same filters (separate query for counting)
  // Uses the applyContactFilters helper to apply the same filters as the main query
  const baseCountQuery = tenantDb
    .selectFrom("contacts")
    .leftJoin("contact_assignments", (join) =>
      join
        .onRef("contact_assignments.contact_id", "=", "contacts.id")
        .on("contact_assignments.unassigned_at", "is", null),
    )
    .leftJoin(
      "conversation_states",
      "conversation_states.contact_id",
      "contacts.id",
    )
    .select((eb) => eb.fn.count("contacts.id").as("total"));

  // The row query hides contacts merged into another customer, so the total
  // has to hide them too or pagination reports a page that is not there.
  //
  // The same applies to every filter the row query answers from the merged
  // group rather than from the surviving row alone: an assignment or an
  // unread thread may sit on the hidden contact. Without the matching group
  // terms here, "assigned to me" returns one row and a total of zero.
  const mergedGroup = (predicate: RawBuilder<unknown>) => sql<SqlBool>`EXISTS (
    SELECT 1
    FROM ${schema}.${sql.ref("contacts")} mc
    LEFT JOIN ${schema}.${sql.ref("contact_assignments")} mca
      ON mca.contact_id = mc.id AND mca.unassigned_at IS NULL
    LEFT JOIN ${schema}.${sql.ref("conversations")} mconv
      ON mconv.legacy_contact_id = mc.id AND mconv.archived_at IS NULL
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} mcsc
      ON mconv.id IS NOT NULL AND mcsc.conversation_id = mconv.id
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} mcsl
      ON mconv.id IS NULL AND mcsl.contact_id = mc.id
    WHERE mc.merged_into_contact_id = contacts.id
      AND ${predicate}
  )`;
  const assignedInGroup = (assigneeId: string) =>
    mergedGroup(sql`mca.assigned_to = ${assigneeId}`);
  let countQuery = baseCountQuery.where(
    "contacts.merged_into_contact_id",
    "is",
    null,
  );
  if (!includeGroups) {
    countQuery = countQuery.where("contacts.is_group", "=", false);
  }
  if (connectionId) {
    countQuery = countQuery.where(
      "contacts.whatsapp_connection_id",
      "=",
      connectionId,
    );
  }
  if (search) {
    const usernameSearch = search.trim().replace(/^@+/, "") || search;
    // The row query restates a formatted number as digits; the total has to
    // count the same rows or pagination reports a page that is not there.
    const phoneDigits = phoneSearchDigits(search);
    countQuery = countQuery.where((eb) =>
      eb.or([
        eb("contacts.push_name", "ilike", `%${search}%`),
        eb("contacts.username", "ilike", `%${usernameSearch}%`),
        eb("contacts.custom_name", "ilike", `%${search}%`),
        eb("contacts.phone_number", "ilike", `%${search}%`),
        ...(phoneDigits
          ? [eb("contacts.phone_number", "ilike", `%${phoneDigits}%`)]
          : []),
      ]),
    );
  }
  if (tagIds?.length) {
    countQuery = countQuery.where("contacts.id", "in", (qb) =>
      qb
        .selectFrom("contact_tags")
        .select("contact_tags.contact_id")
        .where("contact_tags.tag_id", "in", tagIds),
    );
  }
  if ((restrictToAssigned || assignedToMe) && userId) {
    countQuery = countQuery.where((eb) =>
      eb.or([
        eb("contact_assignments.assigned_to", "=", userId),
        assignedInGroup(userId),
      ]),
    );
  } else if (unassigned) {
    countQuery = countQuery
      .where("contact_assignments.assigned_to", "is", null)
      .where(
        sql<SqlBool>`NOT ${mergedGroup(sql`mca.assigned_to IS NOT NULL`)}`,
      );
  }
  if (conversationStatus && conversationStatus !== "all") {
    countQuery = countQuery.where(
      sql<boolean>`COALESCE(conversation_states.status::text, 'resolved') = ${conversationStatus}`,
    );
  }
  if (unreadOnly) {
    countQuery = countQuery.where((eb) =>
      eb.or([
        sql<SqlBool>`COALESCE(conversation_states.unread_count, 0) > 0`,
        mergedGroup(sql`COALESCE(mcsc.unread_count, mcsl.unread_count, 0) > 0`),
      ]),
    );
  }

  const countResult = await countQuery.executeTakeFirst();
  const total = Number(countResult?.total || 0);

  return { contacts, total };
}

/**
 * Assigns a contact to a user
 */
export async function assignContactToUser(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string,
  assignedByUserId: string,
): Promise<{
  id: string;
  assignedTo: string;
  assignedBy: string;
  assignedAt: Date;
}> {
  // Unassign previous assignment
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: toDbDate() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();

  // Create new assignment
  const conversationId = await conversationIdForContact(tenantDb, contactId);
  const assignment = await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: contactId,
      conversation_id: conversationId,
      assigned_to: userId,
      assigned_by: assignedByUserId,
    })
    .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
    .executeTakeFirstOrThrow();

  return {
    id: assignment.id,
    assignedTo: assignment.assigned_to,
    assignedBy: assignment.assigned_by,
    assignedAt: assignment.assigned_at,
  };
}

/**
 * Gets the current assignment for a contact
 */
export async function assignConversationToUser(
  tenantDb: Kysely<TenantDatabase>,
  conversationId: string,
  userId: string,
  assignedByUserId: string,
): Promise<void> {
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: toDbDate() })
    .where("conversation_id", "=", conversationId)
    .where("unassigned_at", "is", null)
    .execute();
  await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: null,
      conversation_id: conversationId,
      assigned_to: userId,
      assigned_by: assignedByUserId,
    })
    .execute();
}

export async function getCurrentConversationAssignment(
  tenantDb: Kysely<TenantDatabase>,
  conversationId: string,
) {
  return tenantDb
    .selectFrom("contact_assignments")
    .select(["id", "assigned_to", "assigned_by", "assigned_at"])
    .where("conversation_id", "=", conversationId)
    .where("unassigned_at", "is", null)
    .executeTakeFirst();
}

export async function getCurrentAssignment(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  conversationId?: string | null,
) {
  return await tenantDb
    .selectFrom("contact_assignments")
    .select(["id", "assigned_to", "assigned_by", "assigned_at"])
    .where("unassigned_at", "is", null)
    .where((eb) =>
      conversationId
        ? eb.or([
            eb("contact_id", "=", contactId),
            eb("conversation_id", "=", conversationId),
          ])
        : eb("contact_id", "=", contactId),
    )
    .executeTakeFirst();
}

/**
 * Unassigns a contact
 */
export async function unassignConversation(
  tenantDb: Kysely<TenantDatabase>,
  conversationId: string,
): Promise<void> {
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: toDbDate() })
    .where("conversation_id", "=", conversationId)
    .where("unassigned_at", "is", null)
    .execute();
}

export async function unassignContact(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<void> {
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: toDbDate() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();
}

/**
 * Ensures a contact is assigned to a user if not already assigned
 * This is used for "Assign to me on first reply"
 */
export async function ensureContactAssignment(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string,
): Promise<boolean> {
  const currentAssignment = await getCurrentAssignment(tenantDb, contactId);

  if (!currentAssignment) {
    await assignContactToUser(tenantDb, contactId, userId, userId);
    return true;
  }

  return false;
}

/**
 * Why a phone number could not be turned into a usable contact.
 *
 * Callers map these to their own transport: HTTP routes to 400/409, MCP tools
 * to McpToolError.
 */
export type OutboundContactErrorCode =
  | "invalid_phone"
  | "no_connection"
  | "ambiguous_connection";

export class OutboundContactError extends Error {
  constructor(
    message: string,
    readonly code: OutboundContactErrorCode,
  ) {
    super(message);
    this.name = "OutboundContactError";
  }
}

export interface FindOrCreateContactByPhoneOptions {
  phoneNumber: string;
  /** Required when the workspace has more than one connected account. */
  connectionId?: string;
  customName?: string;
  notesShared?: string;
}

export interface FindOrCreateContactByPhoneResult {
  contact: {
    id: string;
    jid: string | null;
    phone_number: string | null;
    custom_name: string | null;
    push_name: string | null;
    notes_shared: string | null;
    is_group: boolean;
    created_at: Date;
    updated_at: Date;
  };
  /** False when an existing contact was reused rather than inserted. */
  created: boolean;
  connectionId: string;
}

/**
 * Resolve a raw phone number to a contact on a connected account, creating the
 * contact when it does not exist yet.
 *
 * Shared by the create-contact route and the MCP start_conversation tool so
 * that connection resolution, duplicate handling, and the insert column list
 * stay in one place.
 */
export async function findOrCreateContactByPhone(
  tenantDb: Kysely<TenantDatabase>,
  options: FindOrCreateContactByPhoneOptions,
): Promise<FindOrCreateContactByPhoneResult> {
  const phoneResult = normalizePhoneNumber(options.phoneNumber);
  if (!phoneResult.isValid) {
    throw new OutboundContactError(
      phoneResult.error || "Invalid phone number",
      "invalid_phone",
    );
  }
  const { cleanedPhone, jid } = phoneResult;

  const activeConnections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select("id")
    .where("status", "=", "connected")
    .$if(Boolean(options.connectionId), (query) =>
      query.where("id", "=", options.connectionId as string),
    )
    .limit(2)
    .execute();
  if (activeConnections.length === 0) {
    throw new OutboundContactError(
      "No matching active WhatsApp connection",
      "no_connection",
    );
  }
  if (!options.connectionId && activeConnections.length !== 1) {
    throw new OutboundContactError(
      // Name the way out. A caller that cannot map a phone number to an id has
      // no next move otherwise, which is exactly where an agent gets stuck.
      "connectionId is required when multiple accounts are active. List the accounts and their ids with the list_connections tool, or GET /api/whatsapp/connections.",
      "ambiguous_connection",
    );
  }
  const connectionId = activeConnections[0].id;

  const selection = [
    "id",
    "jid",
    "phone_number",
    "custom_name",
    "push_name",
    "notes_shared",
    "is_group",
    "created_at",
    "updated_at",
  ] as const;

  const existing = await tenantDb
    .selectFrom("contacts")
    .select(selection)
    .where("whatsapp_connection_id", "=", connectionId)
    .where((eb) =>
      eb.or([eb("jid", "=", jid), eb("phone_number", "=", cleanedPhone)]),
    )
    .executeTakeFirst();
  if (existing) {
    return { contact: existing, created: false, connectionId };
  }

  // A concurrent caller can win the race between the lookup above and this
  // insert. The partial unique index on (whatsapp_connection_id, jid) turns
  // that into a conflict rather than a duplicate row, so absorb it and fall
  // back to reading whichever row landed first.
  const inserted = await tenantDb
    .insertInto("contacts")
    .values({
      whatsapp_connection_id: connectionId,
      jid,
      phone_number: cleanedPhone,
      custom_name: options.customName || null,
      notes_shared: options.notesShared || null,
      is_group: false,
    })
    .onConflict((oc) =>
      oc
        .columns(["whatsapp_connection_id", "jid"])
        // The unique index is partial, so Postgres only accepts it as the
        // conflict arbiter when the predicate is restated here.
        .where("whatsapp_connection_id", "is not", null)
        .where("jid", "is not", null)
        .doNothing(),
    )
    .returning(selection)
    .executeTakeFirst();
  if (inserted) {
    return { contact: inserted, created: true, connectionId };
  }

  const raced = await tenantDb
    .selectFrom("contacts")
    .select(selection)
    .where("whatsapp_connection_id", "=", connectionId)
    .where("jid", "=", jid)
    .executeTakeFirst();
  if (!raced) {
    throw new OutboundContactError("Failed to create contact", "invalid_phone");
  }
  return { contact: raced, created: false, connectionId };
}
