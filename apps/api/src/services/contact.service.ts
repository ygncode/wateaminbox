import { toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { buildContactWhereClause } from "./helpers/contact-query-builder.js";
import { getSchemaName, type TenantDatabase } from "./tenant.service.js";

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
  /** Filter to contacts assigned to the current user */
  assignedToMe?: boolean;
  /** Filter to unassigned contacts */
  unassigned?: boolean;
  /** User ID for assignment filters */
  userId?: string;
  /** Enforce assignment visibility regardless of client-provided filters. */
  restrictToAssigned?: boolean;
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
  custom_name: string | null;
  is_group: boolean;
  profile_picture_url: string | null;
  notes_shared: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_to: string | null;
  last_message_at: Date | null;
  unread_count: number | bigint;
  is_online: boolean;
  last_seen: Date | null;
  last_message: {
    id: string;
    messageId: string | null;
    fromMe: boolean;
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
    assignedToMe = false,
    unassigned = false,
    userId,
    restrictToAssigned = false,
  } = options;

  // Use raw SQL for the complex CTE query with window function
  // Kysely's type-safe builder has limitations with CTEs and complex joins
  // The query:
  // 1. Creates a CTE that ranks messages by timestamp per contact using ROW_NUMBER()
  // 2. Joins contacts with last messages (rank=1) and assignments
  // 3. Groups by contact to get unread counts

  // Build WHERE clause using helper (uses parameterized SQL to prevent injection)
  const { whereClause, hasConditions: hasWhereCondition } =
    buildContactWhereClause({
      search,
      includeGroups,
      assignedToMe,
      unassigned,
      userId,
      restrictToAssigned,
    });

  // `withSchema()` qualifies Kysely query-builder calls, but raw SQL has to
  // qualify identifiers itself. The tenant schema comes from trusted middleware.
  const schema = sql.ref(getSchemaName(companyId));

  const result = await sql<{
    id: string;
    jid: string | null;
    phone_number: string | null;
    push_name: string | null;
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
    is_online: boolean;
    last_seen: Date | null;
  }>`
    WITH last_messages AS (
      SELECT
        contact_id,
        id,
        message_id,
        from_me,
        message_type,
        content,
        status,
        timestamp,
        ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY timestamp DESC, id DESC) as rn
      FROM ${schema}.${sql.ref("messages")}
    )
    SELECT
      c.id,
      c.jid,
      c.phone_number,
      c.push_name,
      c.custom_name,
      c.is_group,
      c.profile_picture_url,
      c.notes_shared,
      c.created_at,
      c.updated_at,
      c.is_online,
      c.last_seen,
      ca.assigned_to,
      lm.timestamp as last_message_at,
      lm.id as last_message_id,
      lm.message_id as last_message_message_id,
      lm.from_me as last_message_from_me,
      lm.message_type as last_message_message_type,
      lm.content as last_message_content,
      lm.status as last_message_status,
      lm.timestamp as last_message_timestamp,
      COALESCE(cs.unread_count, 0)::bigint as unread_count
    FROM ${schema}.${sql.ref("contacts")} c
    LEFT JOIN ${schema}.${sql.ref("contact_assignments")} ca
      ON ca.contact_id = c.id
      AND ca.unassigned_at IS NULL
    LEFT JOIN last_messages lm
      ON lm.contact_id = c.id
      AND lm.rn = 1
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} cs
      ON cs.contact_id = c.id
    ${hasWhereCondition ? sql`WHERE ${whereClause}` : sql``}
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(tenantDb);

  const rawContacts = result.rows;

  // Transform to the expected format
  const contacts: ContactWithLastMessage[] = rawContacts.map((contact) => {
    const lastMessage =
      contact.last_message_id !== null
        ? {
            id: contact.last_message_id,
            messageId: contact.last_message_message_id,
            fromMe: contact.last_message_from_me!,
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
      custom_name: contact.custom_name,
      is_group: contact.is_group,
      profile_picture_url: contact.profile_picture_url,
      notes_shared: contact.notes_shared,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
      assigned_to: contact.assigned_to,
      last_message_at: contact.last_message_at,
      unread_count: BigInt(contact.unread_count),
      is_online: contact.is_online,
      last_seen: contact.last_seen,
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
    .select((eb) => eb.fn.count("contacts.id").as("total"));

  let countQuery = baseCountQuery;
  if (!includeGroups) {
    countQuery = countQuery.where("contacts.is_group", "=", false);
  }
  if (search) {
    countQuery = countQuery.where((eb) =>
      eb.or([
        eb("contacts.push_name", "ilike", `%${search}%`),
        eb("contacts.custom_name", "ilike", `%${search}%`),
        eb("contacts.phone_number", "ilike", `%${search}%`),
      ]),
    );
  }
  if (restrictToAssigned && userId) {
    countQuery = countQuery.where(
      "contact_assignments.assigned_to",
      "=",
      userId,
    );
  } else if (assignedToMe && userId) {
    countQuery = countQuery.where(
      "contact_assignments.assigned_to",
      "=",
      userId,
    );
  } else if (unassigned) {
    countQuery = countQuery.where(
      "contact_assignments.assigned_to",
      "is",
      null,
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
  const assignment = await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: contactId,
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
export async function getCurrentAssignment(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
) {
  return await tenantDb
    .selectFrom("contact_assignments")
    .select(["id", "assigned_to", "assigned_by", "assigned_at"])
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .executeTakeFirst();
}

/**
 * Unassigns a contact
 */
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
