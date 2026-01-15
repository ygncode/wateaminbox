import type { SelectQueryBuilder, Kysely } from "kysely";
import { sql, type RawBuilder } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";

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
  const hasAssignmentFilter = (assignedToMe && userId) || unassigned;
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

/**
 * Apply search filters to a Kysely query builder.
 * This is used for the count query which uses Kysely's type-safe builder.
 *
 * @param query - Kysely query builder
 * @param search - Search term
 * @returns Modified query builder
 */
export function applySearchFilter<
  T extends SelectQueryBuilder<TenantDatabase, "contacts", object>,
>(query: T, search?: string): T {
  if (!search) return query;

  return query.where((eb) =>
    eb.or([
      eb("contacts.push_name", "ilike", `%${search}%`),
      eb("contacts.custom_name", "ilike", `%${search}%`),
      eb("contacts.phone_number", "ilike", `%${search}%`),
    ]),
  ) as T;
}

/**
 * Apply group filter to a Kysely query builder.
 *
 * @param query - Kysely query builder
 * @param includeGroups - Whether to include groups
 * @returns Modified query builder
 */
export function applyGroupFilter<
  T extends SelectQueryBuilder<TenantDatabase, "contacts", object>,
>(query: T, includeGroups: boolean): T {
  if (includeGroups) return query;
  return query.where("contacts.is_group", "=", false) as T;
}

/**
 * Apply assignment filter to a Kysely query builder.
 * Assumes contact_assignments is already joined.
 *
 * @param query - Kysely query builder
 * @param options - Filter options
 * @returns Modified query builder
 */
export function applyAssignmentFilter<
  T extends SelectQueryBuilder<
    TenantDatabase,
    "contacts" | "contact_assignments",
    object
  >,
>(
  query: T,
  options: { assignedToMe?: boolean; unassigned?: boolean; userId?: string },
): T {
  const { assignedToMe, unassigned, userId } = options;

  if (assignedToMe && userId) {
    return query.where("contact_assignments.assigned_to", "=", userId) as T;
  }

  if (unassigned) {
    return query.where("contact_assignments.assigned_to", "is", null) as T;
  }

  return query;
}

/**
 * Apply all contact filters to a Kysely query builder.
 * This combines search, group, and assignment filters.
 *
 * @param query - Kysely query builder (must have contact_assignments joined if using assignment filters)
 * @param options - Filter options
 * @returns Modified query builder
 */
export function applyContactFilters<
  T extends SelectQueryBuilder<
    TenantDatabase,
    "contacts" | "contact_assignments",
    object
  >,
>(query: T, options: ContactFilterOptions): T {
  let result = query;
  result = applyGroupFilter(result, options.includeGroups ?? false);
  result = applySearchFilter(result, options.search);
  result = applyAssignmentFilter(result, {
    assignedToMe: options.assignedToMe,
    unassigned: options.unassigned,
    userId: options.userId,
  });
  return result;
}
