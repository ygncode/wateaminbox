import { sql, type RawBuilder } from "kysely";

/**
 * Options for building contact query filters
 */
export interface ContactFilterOptions {
  /** Search term to filter by name or phone number */
  search?: string;
  /** Whether to include group contacts */
  includeGroups?: boolean;
  /** Filter to contacts assigned to the current user */
  assignedToMe?: boolean;
  /** Filter to unassigned contacts */
  unassigned?: boolean;
  /** User ID for assignment filters */
  userId?: string;
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
  return sql`(c.push_name ILIKE ${searchValue} OR c.custom_name ILIKE ${searchValue} OR c.phone_number ILIKE ${searchValue})`;
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
}): RawBuilder<unknown> {
  const { assignedToMe, unassigned, userId } = options;

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
    assignedToMe,
    unassigned,
    userId,
  } = options;

  const searchClause = buildSearchClause(search);
  const groupClause = buildGroupClause(includeGroups);
  const assignmentClause = buildAssignmentClause({
    assignedToMe,
    unassigned,
    userId,
  });

  // Check boolean flags directly (not RawBuilder objects which are always truthy)
  const hasSearch = Boolean(search);
  const hasGroupFilter = !includeGroups;
  const hasAssignmentFilter = Boolean((assignedToMe && userId) || unassigned);
  const hasConditions = hasSearch || hasGroupFilter || hasAssignmentFilter;

  // Build WHERE clause by combining conditions with proper AND logic
  const whereClause = sql<unknown>`
    ${hasSearch ? searchClause : sql``}
    ${hasSearch && (hasGroupFilter || hasAssignmentFilter) ? sql`AND` : sql``}
    ${hasGroupFilter ? groupClause : sql``}
    ${hasGroupFilter && hasAssignmentFilter ? sql`AND` : sql``}
    ${hasAssignmentFilter ? assignmentClause : sql``}
  `;

  return { whereClause, hasConditions };
}
