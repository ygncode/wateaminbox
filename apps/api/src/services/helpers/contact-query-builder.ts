import { type RawBuilder, sql } from "kysely";

/**
 * Options for building contact query filters
 */
export interface ContactFilterOptions {
  /** Search term to filter by name or phone number */
  search?: string;
  /** Whether to include group contacts */
  includeGroups?: boolean;
  /** Filter to conversations owned by one WhatsApp account. */
  connectionId?: string;
  /** Match contacts carrying any of these workspace tags. */
  tagIds?: string[];
  /** Schema-qualified contact_tags table used by raw tenant SQL. */
  contactTagsTable?: RawBuilder<unknown>;
  /** Filter to contacts assigned to the current user */
  assignedToMe?: boolean;
  /** Filter to unassigned contacts */
  unassigned?: boolean;
  /** User ID for assignment filters */
  userId?: string;
  /** Force results to active assignments owned by userId. */
  restrictToAssigned?: boolean;
  /** Filter by conversation lifecycle status. "all" (or omitted) applies no filter. */
  conversationStatus?: "open" | "pending" | "resolved" | "all";
  /** Filter to conversations with unread messages. */
  unreadOnly?: boolean;
}

/**
 * Build conversation-lifecycle filter SQL clause for raw SQL queries.
 * A contact with no conversation_states row (never messaged, or created
 * directly rather than through history/live sync) is treated as "resolved" -
 * the same non-SLA baseline every existing conversation was closed into by
 * migration 061.
 */
export function buildConversationStatusClause(
  conversationStatus?: "open" | "pending" | "resolved" | "all",
): RawBuilder<unknown> {
  if (!conversationStatus || conversationStatus === "all") return sql``;
  return sql`COALESCE(cs.status, 'resolved') = ${conversationStatus}`;
}

/**
 * Build search filter SQL clause for raw SQL queries.
 * Uses parameterized query to prevent SQL injection.
 *
 * @param search - Search term
 * @returns SQL fragment for search filter or empty SQL
 */
export function buildSearchClause(search?: string): RawBuilder<unknown> {
  if (!search) return sql``;
  const searchValue = `%${search}%`;
  const username = search.trim().replace(/^@+/, "") || search;
  const usernameSearchValue = `%${username}%`;
  return sql`(c.push_name ILIKE ${searchValue} OR c.username ILIKE ${usernameSearchValue} OR c.custom_name ILIKE ${searchValue} OR c.phone_number ILIKE ${searchValue})`;
}

/**
 * Build group filter SQL clause for raw SQL queries.
 *
 * @param includeGroups - Whether to include groups
 * @returns SQL fragment for group filter or empty SQL
 */
export function buildGroupClause(includeGroups: boolean): RawBuilder<unknown> {
  if (includeGroups) return sql``;
  return sql`c.is_group = false`;
}

/**
 * Build assignment filter SQL clause for raw SQL queries.
 * Uses parameterized query for userId to prevent SQL injection.
 *
 * @param options - Filter options
 * @returns SQL fragment for assignment filter or empty SQL
 */
export function buildAssignmentClause(options: {
  assignedToMe?: boolean;
  unassigned?: boolean;
  userId?: string;
  restrictToAssigned?: boolean;
}): RawBuilder<unknown> {
  const { assignedToMe, unassigned, userId, restrictToAssigned } = options;

  if (restrictToAssigned && userId) {
    return sql`ca.assigned_to = ${userId}`;
  }

  if (assignedToMe && userId) {
    return sql`ca.assigned_to = ${userId}`;
  }

  if (unassigned) {
    return sql`ca.assigned_to IS NULL`;
  }

  return sql``;
}

/**
 * Build complete WHERE clause for contact queries.
 * Combines search, group, and assignment filters with proper AND logic.
 *
 * @param options - Filter options
 * @returns Object with WHERE clause SQL and a flag indicating if any conditions exist
 */
export function buildContactWhereClause(options: ContactFilterOptions): {
  whereClause: RawBuilder<unknown>;
  hasConditions: boolean;
} {
  const {
    search,
    includeGroups = false,
    connectionId,
    tagIds,
    contactTagsTable,
    assignedToMe,
    unassigned,
    userId,
    restrictToAssigned,
    conversationStatus,
    unreadOnly,
  } = options;

  const conditions: RawBuilder<unknown>[] = [];
  if (search) conditions.push(buildSearchClause(search));
  if (!includeGroups) conditions.push(buildGroupClause(includeGroups));
  if (connectionId) {
    conditions.push(sql`c.whatsapp_connection_id = ${connectionId}`);
  }
  if (tagIds?.length) {
    if (!contactTagsTable) {
      throw new Error("contactTagsTable is required when filtering by tags");
    }
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ${contactTagsTable} ct
      WHERE ct.contact_id = c.id
        AND ct.tag_id = ANY(${tagIds}::uuid[])
    )`);
  }
  if (conversationStatus && conversationStatus !== "all") {
    conditions.push(buildConversationStatusClause(conversationStatus));
  }
  if (unreadOnly) {
    // A contact with no conversation_states row has nothing unread.
    conditions.push(sql`COALESCE(cs.unread_count, 0) > 0`);
  }

  const hasAssignmentFilter = Boolean(
    (restrictToAssigned && userId) || (assignedToMe && userId) || unassigned,
  );
  if (hasAssignmentFilter) {
    conditions.push(
      buildAssignmentClause({
        assignedToMe,
        unassigned,
        userId,
        restrictToAssigned,
      }),
    );
  }

  return {
    whereClause:
      conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql``,
    hasConditions: conditions.length > 0,
  };
}
