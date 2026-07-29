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

import { getCompanyId } from "../lib/api/client";

/**
 * Type for the query key factory return value.
 * Provides type-safe query key generation with proper tuple types.
 */
export interface QueryKeyFactory<TDomain extends string> {
  /** Base key for all queries in this domain */
  all: readonly [TDomain, string | null];
  /** Key for list queries (without filters) */
  lists: () => readonly [TDomain, string | null, "list"];
  /** Key for list queries with filters */
  list: <TFilters extends Record<string, unknown>>(
    filters: TFilters,
  ) => readonly [TDomain, string | null, "list", TFilters];
  /** Key for detail queries (without id) */
  details: () => readonly [TDomain, string | null, "detail"];
  /** Key for a specific detail query */
  detail: (id: string) => readonly [TDomain, string | null, "detail", string];
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
  domain: TDomain,
): QueryKeyFactory<TDomain> {
  return {
    get all() {
      return [domain, getCompanyId()] as const;
    },
    lists: () => [domain, getCompanyId(), "list"] as const,
    list: <TFilters extends Record<string, unknown>>(filters: TFilters) =>
      [domain, getCompanyId(), "list", filters] as const,
    details: () => [domain, getCompanyId(), "detail"] as const,
    detail: (id: string) => [domain, getCompanyId(), "detail", id] as const,
  };
}

/**
 * Pre-defined query key factories for common domains.
 * These can be imported directly instead of creating new factories.
 */
export const queryKeys = {
  contacts: createQueryKeyFactory("contacts"),
  groups: createQueryKeyFactory("groups"),
  messages: createQueryKeyFactory("messages"),
  conversations: createQueryKeyFactory("conversations"),
  tags: createQueryKeyFactory("tags"),
  whatsapp: createQueryKeyFactory("whatsapp"),
  privateNotes: createQueryKeyFactory("privateNotes"),
  sharedNotes: createQueryKeyFactory("sharedNotes"),
  assignmentHistory: createQueryKeyFactory("assignmentHistory"),
  chats: createQueryKeyFactory("chats"),
  search: createQueryKeyFactory("search"),
  status: createQueryKeyFactory("status"),
  export: createQueryKeyFactory("export"),

  // Analytics - custom keys for different analytics queries
  analytics: {
    all: ["analytics"] as const,
    dashboard: (companyId: string | null) =>
      ["analytics", "dashboard", companyId] as const,
    messages: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) => ["analytics", "messages", companyId, startDate, endDate] as const,
    contacts: (companyId: string | null) =>
      ["analytics", "contacts", companyId] as const,
    contactsTrend: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) =>
      ["analytics", "contacts-trend", companyId, startDate, endDate] as const,
    team: (companyId: string | null) =>
      ["analytics", "team", companyId] as const,
    messageTypes: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) => ["analytics", "message-types", companyId, startDate, endDate] as const,
    hourly: (companyId: string | null, days: number) =>
      ["analytics", "hourly", companyId, days] as const,
    resolution: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) => ["analytics", "resolution", companyId, startDate, endDate] as const,
    resolutionTrend: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) =>
      ["analytics", "resolution-trend", companyId, startDate, endDate] as const,
    engagement: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) => ["analytics", "engagement", companyId, startDate, endDate] as const,
    engagementTrend: (
      companyId: string | null,
      startDate?: string,
      endDate?: string,
    ) =>
      ["analytics", "engagement-trend", companyId, startDate, endDate] as const,
  },

  // Team/Company - custom keys for company resources
  team: {
    all: ["company"] as const,
    members: <T extends object>(companyId: string | null, params?: T) =>
      params
        ? (["company", companyId, "members", params] as const)
        : (["company", companyId, "members"] as const),
    invitations: <T extends object>(companyId: string | null, params?: T) =>
      params
        ? (["company", companyId, "invitations", params] as const)
        : (["company", companyId, "invitations"] as const),
    invitation: (token: string | null) => ["invitation", token] as const,
    companies: () => ["companies"] as const,
  },

  // Audit - custom keys for audit logs
  audit: {
    all: ["audit"] as const,
    logs: <T extends object>(companyId: string | null, params?: T) =>
      ["audit", companyId, params] as const,
    actions: () => ["audit", getCompanyId(), "actions"] as const,
    actors: () => ["audit", getCompanyId(), "actors"] as const,
  },

  // Quick replies - custom keys for quick reply management
  quickReplies: {
    get all() {
      return ["quick-replies", getCompanyId()] as const;
    },
    lists: () => ["quick-replies", getCompanyId(), "list"] as const,
    list: <T extends object>(params?: T) =>
      ["quick-replies", getCompanyId(), "list", params] as const,
    search: (shortcut: string) =>
      ["quick-replies", getCompanyId(), "search", shortcut] as const,
  },

  // Notifications - custom keys for in-app notifications
  notifications: {
    get all() {
      return ["notifications", getCompanyId()] as const;
    },
    lists: () => ["notifications", getCompanyId(), "list"] as const,
    list: <T extends object>(params?: T) =>
      ["notifications", getCompanyId(), "list", params] as const,
    count: () => ["notifications", getCompanyId(), "count"] as const,
  },

  // Notification preferences - for settings
  notificationPreferences: {
    get all() {
      return ["notificationPreferences", getCompanyId()] as const;
    },
  },
} as const;
