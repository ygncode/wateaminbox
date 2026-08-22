import { useQuery } from "@tanstack/react-query";
import { api, buildQueryString } from "@/lib/api/client";
import { queryKeys } from "./query-keys";

export interface MessageSearchResult {
  id: string;
  contactId: string;
  contactName: string | null;
  contactJid: string | null;
  isGroup: boolean;
  messageId: string | null;
  content: string | null;
  messageType: string | null;
  timestamp: string;
  highlights: string | null;
  rank: number;
}

export interface ContactSearchResult {
  id: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  username?: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  profilePictureUrl: string | null;
  notesShared: string | null;
}

export interface GlobalSearchResult {
  query: string;
  messages: MessageSearchResult[];
  contacts: ContactSearchResult[];
}

export interface MessageSearchOptions {
  limit?: number;
  offset?: number;
  contactId?: string;
  startDate?: string;
  endDate?: string;
  messageTypes?: string[];
}

/**
 * Extended query keys for search with custom patterns
 * Uses the base queryKeys.search and extends with search-specific keys
 */
export const searchKeys = {
  get all() {
    return queryKeys.search.all;
  },
  lists: queryKeys.search.lists,
  list: queryKeys.search.list,
  details: queryKeys.search.details,
  detail: queryKeys.search.detail,
  global: (query: string) =>
    [...queryKeys.search.all, "global", query] as const,
  messages: (query: string, options?: MessageSearchOptions) =>
    [...queryKeys.search.all, "messages", query, options] as const,
  contacts: (query: string, includeGroups?: boolean) =>
    [...queryKeys.search.all, "contacts", query, includeGroups] as const,
};

/**
 * Hook for global search (messages + contacts)
 */
export function useGlobalSearch(query: string, enabled: boolean = true) {
  return useQuery<GlobalSearchResult, Error>({
    queryKey: searchKeys.global(query),
    queryFn: async () => {
      const queryString = buildQueryString({ q: query });
      return api.get<GlobalSearchResult>(`/search${queryString}`);
    },
    enabled: enabled && query.trim().length >= 2,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook for message search with pagination and filters
 */
export function useMessageSearch(
  query: string,
  options: MessageSearchOptions = {},
  enabled: boolean = true,
) {
  return useQuery<
    {
      query: string;
      data: MessageSearchResult[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    },
    Error
  >({
    queryKey: searchKeys.messages(query, options),
    queryFn: async () => {
      const params: Record<string, unknown> = {
        q: query,
      };
      if (options.limit) params.limit = options.limit;
      if (options.offset) params.offset = options.offset;
      if (options.contactId) params.contactId = options.contactId;
      if (options.startDate) params.startDate = options.startDate;
      if (options.endDate) params.endDate = options.endDate;
      if (options.messageTypes?.length) {
        params.messageTypes = options.messageTypes.join(",");
      }

      const queryString = buildQueryString(params);
      return api.get(`/search/messages${queryString}`);
    },
    enabled: enabled && query.trim().length >= 2,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook for searching messages within a specific conversation
 */
export function useConversationSearch(
  query: string,
  contactId: string | undefined,
  enabled: boolean = true,
) {
  return useQuery<
    {
      query: string;
      data: MessageSearchResult[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    },
    Error
  >({
    queryKey: searchKeys.messages(query, { contactId }),
    queryFn: async () => {
      const params: Record<string, unknown> = {
        q: query,
        limit: 50,
      };
      if (contactId) params.contactId = contactId;

      const queryString = buildQueryString(params);
      return api.get(`/search/messages${queryString}`);
    },
    enabled: enabled && query.trim().length >= 2 && !!contactId,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook for contact search
 */
export function useContactSearch(
  query: string,
  includeGroups: boolean = true,
  enabled: boolean = true,
) {
  return useQuery<
    {
      query: string;
      data: ContactSearchResult[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    },
    Error
  >({
    queryKey: searchKeys.contacts(query, includeGroups),
    queryFn: async () => {
      const queryString = buildQueryString({
        q: query,
        includeGroups: String(includeGroups),
      });
      return api.get(`/search/contacts${queryString}`);
    },
    enabled: enabled && query.trim().length >= 2,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}
