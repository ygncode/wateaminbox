/**
 * Hook for fetching contacts for the forward message dialog.
 */

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, buildQueryString, getAccessToken, getCompanyId } from "@/lib/api";
import {
  type ContactsListResponse,
  transformContactToChat,
} from "@/lib/api/transformers";
import type { Chat } from "@/types/chat";
import { chatKeys } from "./useChats";

/**
 * Hook to fetch contacts for the forward message dialog.
 *
 * Features:
 * - Includes groups in the list
 * - Background refresh for fresh data
 *
 * @param searchQuery - Optional search query to filter contacts
 */
export function useForwardContacts(searchQuery: string = "") {
  // Memoize the query key
  const queryKey = useMemo(
    () =>
      chatKeys.list({
        search: searchQuery,
        includeGroups: true,
        assignmentFilter: "all",
      }),
    [searchQuery],
  );

  return useQuery<Chat[], Error>({
    queryKey,
    queryFn: async () => {
      const token = getAccessToken();
      const companyId = getCompanyId();

      // If not authenticated or no company, return empty (protected route will handle redirect)
      if (!token || !companyId) {
        return [];
      }

      // Build query params
      const params: Record<string, unknown> = {
        limit: 100,
        includeGroups: "true",
      };
      if (searchQuery.trim()) {
        params.search = searchQuery;
      }

      const queryString = buildQueryString(params);
      const result = await api.get<ContactsListResponse>(
        `/contacts${queryString}`,
      );

      return result.data.map(transformContactToChat);
    },
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
    retryDelay: 500,
  });
}

/**
 * Prefetch forward contacts for faster perceived loading.
 * Call this when the message context menu opens.
 */
export async function prefetchForwardContacts(queryClient: QueryClient) {
  const token = getAccessToken();
  const companyId = getCompanyId();

  if (!token || !companyId) return;

  await queryClient.prefetchQuery({
    queryKey: chatKeys.list({
      search: "",
      includeGroups: true,
      assignmentFilter: "all",
    }),
    queryFn: async () => {
      const queryString = buildQueryString({
        limit: 100,
        includeGroups: "true",
      });
      const result = await api.get<ContactsListResponse>(
        `/contacts${queryString}`,
      );
      return result.data.map(transformContactToChat);
    },
    staleTime: 1000 * 30, // Consider stale after 30 seconds
  });
}
