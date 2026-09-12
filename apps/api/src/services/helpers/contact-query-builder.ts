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
  /** Schema-qualified contacts table used by raw tenant SQL. */
  contactsTable?: RawBuilder<unknown>;
  /** Schema-qualified contact_assignments table used by raw tenant SQL. */
  contactAssignmentsTable?: RawBuilder<unknown>;
}

/**
 * Whether any contact merged into `c` satisfies `predicate`.
 *
 * A merged customer is one inbox row, so a filter has to be answered by the
 * group rather than by the surviving row alone. Hiding the merged-away row
 * while leaving its assignment invisible would drop an assigned chat out of
 * its own assignee's filter entirely.
 *
 * Written as a correlated EXISTS rather than widening the list query's joins:
 * it reads the partial index on `merged_into_contact_id`, and on a workspace
 * with no merges - which is every workspace today - it is an empty index
 * probe that cannot change the plan of the surrounding query.
 */
function mergedGroupExists(
  contactsTable: RawBuilder<unknown>,
  joins: RawBuilder<unknown>,
  predicate: RawBuilder<unknown>,
): RawBuilder<unknown> {
  return sql`EXISTS (
    SELECT 1
    FROM ${contactsTable} mc
    ${joins}
    WHERE mc.merged_into_contact_id = c.id
      AND ${predicate}
  )`;
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
  // Resolved from whichever side of the list query matched: the conversation
  // when the contact has one, the contact itself only when it could never be
  // bridged. Naming a single alias here silently broke every lifecycle filter
  // the moment the list gained the second one.
  return sql`COALESCE(csc.status, csl.status, 'resolved') = ${conversationStatus}`;
}

/**
 * Digits-only restatement of a formatted phone search.
 *
 * Stored phone numbers are bare digits (see normalizePhoneNumber), so a caller
 * who types "+91 79810 75978" - the format WhatsApp and the Add Contact hint
 * both encourage - can never match `phone_number ILIKE '%+91 79810 75978%'`.
 * Callers OR this value in as a second pattern.
 *
 * @param search - Raw search term.
 * @returns The digits to match, or null when the ILIKE pattern already covers
 *   the search (it is digits-only) or it carries no usable number.
 */
export function phoneSearchDigits(search?: string): string | null {
  const trimmed = search?.trim() ?? "";
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length < 3 || digits === trimmed) return null;
  return digits;
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
  const phoneDigits = phoneSearchDigits(search);
  const phoneDigitsClause = phoneDigits
    ? sql` OR c.phone_number ILIKE ${`%${phoneDigits}%`}`
    : sql``;
  return sql`(c.push_name ILIKE ${searchValue}
    OR c.username ILIKE ${usernameSearchValue}
    OR c.custom_name ILIKE ${searchValue}
    OR c.phone_number ILIKE ${searchValue}${phoneDigitsClause})`;
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
  contactsTable?: RawBuilder<unknown>;
  contactAssignmentsTable?: RawBuilder<unknown>;
}): RawBuilder<unknown> {
  const {
    assignedToMe,
    unassigned,
    userId,
    restrictToAssigned,
    contactsTable,
    contactAssignmentsTable,
  } = options;

  // The assignment may sit on a merged-away row, whose own list entry is
  // hidden. Without the group term the surviving row answers "not mine" and
  // the chat disappears from its assignee's filter.
  const assignedInGroup = (assigneeId: string): RawBuilder<unknown> =>
    contactsTable && contactAssignmentsTable
      ? mergedGroupExists(
          contactsTable,
          sql`JOIN ${contactAssignmentsTable} mca
                ON mca.contact_id = mc.id
               AND mca.unassigned_at IS NULL`,
          sql`mca.assigned_to = ${assigneeId}`,
        )
      : sql`FALSE`;

  if (restrictToAssigned && userId) {
    return sql`(ca.assigned_to = ${userId} OR ${assignedInGroup(userId)})`;
  }

  if (assignedToMe && userId) {
    return sql`(ca.assigned_to = ${userId} OR ${assignedInGroup(userId)})`;
  }

  if (unassigned) {
    // Unassigned means nobody in the group holds it, not merely that the
    // surviving row does not.
    const anyoneAssigned =
      contactsTable && contactAssignmentsTable
        ? mergedGroupExists(
            contactsTable,
            sql`JOIN ${contactAssignmentsTable} mca
                  ON mca.contact_id = mc.id
                 AND mca.unassigned_at IS NULL`,
            sql`mca.assigned_to IS NOT NULL`,
          )
        : sql`FALSE`;
    return sql`(ca.assigned_to IS NULL AND NOT ${anyoneAssigned})`;
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
    contactsTable,
    contactAssignmentsTable,
  } = options;

  const conditions: RawBuilder<unknown>[] = [];
  // A merged customer is one row in the inbox. The surviving contact carries
  // the group; the rows merged into it stay reachable through the chat
  // switcher rather than as separate entries. Their threads are untouched -
  // a merge never moves a conversation.
  conditions.push(sql`c.merged_into_contact_id IS NULL`);
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
    // A contact with no conversation_states row has nothing unread. Unread on
    // a merged-away thread counts for the surviving row, which is where the
    // operator now sees it.
    conditions.push(
      sql`(COALESCE(csc.unread_count, csl.unread_count, 0) > 0
           OR COALESCE(grp.unread_count, 0) > 0)`,
    );
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
        contactsTable,
        contactAssignmentsTable,
      }),
    );
  }

  return {
    whereClause:
      conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql``,
    hasConditions: conditions.length > 0,
  };
}
