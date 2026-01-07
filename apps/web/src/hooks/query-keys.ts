/**
 * Query Key Factory Utility
 *
 * Creates standardized query key structures for React Query hooks.
 * This ensures consistent cache key patterns across all hooks and
 * enables proper cache invalidation.
 *
 * @example
 * ```ts
 * const contactKeys = createQueryKeyFactory('contacts')
 *
 * // Usage in hooks:
 * queryKey: contactKeys.all           // ['contacts']
 * queryKey: contactKeys.lists()       // ['contacts', 'list']
 * queryKey: contactKeys.list({ search: 'john' })  // ['contacts', 'list', { search: 'john' }]
 * queryKey: contactKeys.details()     // ['contacts', 'detail']
 * queryKey: contactKeys.detail('123') // ['contacts', 'detail', '123']
 * ```
 */

/**
 * Type for the query key factory return value.
 * Provides type-safe query key generation with proper tuple types.
 */
export interface QueryKeyFactory<TDomain extends string> {
  /** Base key for all queries in this domain */
  all: readonly [TDomain]
  /** Key for list queries (without filters) */
  lists: () => readonly [TDomain, 'list']
  /** Key for list queries with filters */
  list: <TFilters extends Record<string, unknown>>(
    filters: TFilters
  ) => readonly [TDomain, 'list', TFilters]
  /** Key for detail queries (without id) */
  details: () => readonly [TDomain, 'detail']
  /** Key for a specific detail query */
  detail: (id: string) => readonly [TDomain, 'detail', string]
}

/**
 * Creates a type-safe query key factory for a given domain.
 *
 * The factory follows the standard pattern:
 * - `all`: Base key for all queries in this domain
 * - `lists()`: Key for list queries (invalidates all lists)
 * - `list(filters)`: Key for filtered list queries
 * - `details()`: Key for all detail queries
 * - `detail(id)`: Key for a specific detail query
 *
 * This pattern enables efficient cache invalidation:
 * - Invalidate all: `queryClient.invalidateQueries({ queryKey: keys.all })`
 * - Invalidate lists only: `queryClient.invalidateQueries({ queryKey: keys.lists() })`
 * - Invalidate one detail: `queryClient.invalidateQueries({ queryKey: keys.detail(id) })`
 *
 * @param domain - The domain name (e.g., 'contacts', 'groups', 'messages')
 * @returns A query key factory object with type-safe methods
 */
export function createQueryKeyFactory<TDomain extends string>(
  domain: TDomain
): QueryKeyFactory<TDomain> {
  return {
    all: [domain] as const,
    lists: () => [domain, 'list'] as const,
    list: <TFilters extends Record<string, unknown>>(filters: TFilters) =>
      [domain, 'list', filters] as const,
    details: () => [domain, 'detail'] as const,
    detail: (id: string) => [domain, 'detail', id] as const,
  }
}

/**
 * Pre-defined query key factories for common domains.
 * These can be imported directly instead of creating new factories.
 */
export const queryKeys = {
  contacts: createQueryKeyFactory('contacts'),
  groups: createQueryKeyFactory('groups'),
  messages: createQueryKeyFactory('messages'),
  conversations: createQueryKeyFactory('conversations'),
  tags: createQueryKeyFactory('tags'),
  team: createQueryKeyFactory('team'),
  analytics: createQueryKeyFactory('analytics'),
  audit: createQueryKeyFactory('audit'),
} as const
