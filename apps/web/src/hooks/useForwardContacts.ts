/**
 * Hook for fetching contacts for the forward message dialog.
 */

import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import {
  api,
  buildQueryString,
  getAccessToken,
  getCompanyId,
} from "@/lib/api/client";
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
export function forwardContactsQueryOptions(
  searchQuery: string = "",
  enabled: boolean = true,
) {
  return queryOptions<Chat[], Error>({
    // Resolve the workspace-scoped key on every render, including switches
    // where the search string has not changed.
    queryKey: chatKeys.list({
      search: searchQuery,
      includeGroups: true,
      assignmentFilter: "all",
    }),
    // Closed dialogs stay mounted, but must not keep this expensive list
    // active when realtime events invalidate every chat-list query.
    enabled: enabled && !!getAccessToken() && !!getCompanyId(),
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

export function useForwardContacts(
  searchQuery: string = "",
  enabled: boolean = true,
) {
  return useQuery(forwardContactsQueryOptions(searchQuery, enabled));
}

/**
 * Prefetch forward contacts for faster perceived loading.
 * Call this when the message context menu opens.
 */
export async function prefetchForwardContacts(queryClient: QueryClient) {
  const token = getAccessToken();
  const companyId = getCompanyId();

  if (!token || !companyId) return;

  const { queryKey, queryFn } = forwardContactsQueryOptions();
  await queryClient.prefetchQuery({
    queryKey,
    queryFn,
    staleTime: 1000 * 30, // Consider stale after 30 seconds
  });
}
