import { useQuery } from "@tanstack/react-query";
import { getAccessToken } from "../lib/api";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";

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
 * Query keys for search-related queries
 */
export const searchKeys = {
  all: ["search"] as const,
  global: (query: string) => [...searchKeys.all, "global", query] as const,
  messages: (query: string, options?: MessageSearchOptions) =>
    [...searchKeys.all, "messages", query, options] as const,
  contacts: (query: string, includeGroups?: boolean) =>
    [...searchKeys.all, "contacts", query, includeGroups] as const,
};

/**
 * Hook for global search (messages + contacts)
 */
export function useGlobalSearch(query: string, enabled: boolean = true) {
  return useQuery<GlobalSearchResult, Error>({
    queryKey: searchKeys.global(query),
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const params = new URLSearchParams();
      params.set("q", query);

      const response = await fetch(`${API_BASE_URL}/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      return response.json();
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
      const token = getAccessToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const params = new URLSearchParams();
      params.set("q", query);
      if (options.limit) params.set("limit", String(options.limit));
      if (options.offset) params.set("offset", String(options.offset));
      if (options.contactId) params.set("contactId", options.contactId);
      if (options.startDate) params.set("startDate", options.startDate);
      if (options.endDate) params.set("endDate", options.endDate);
      if (options.messageTypes?.length) {
        params.set("messageTypes", options.messageTypes.join(","));
      }

      const response = await fetch(
        `${API_BASE_URL}/search/messages?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Search failed");
      }

      return response.json();
    },
    enabled: enabled && query.trim().length >= 2,
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
      const token = getAccessToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const params = new URLSearchParams();
      params.set("q", query);
      params.set("includeGroups", String(includeGroups));

      const response = await fetch(
        `${API_BASE_URL}/search/contacts?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Search failed");
      }

      return response.json();
    },
    enabled: enabled && query.trim().length >= 2,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}
