import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { queryKeys } from "./query-keys";

/**
 * Returns a stable prefetch function for contact data
 * The prefetch is debounced to prevent excessive requests during fast scrolling
 *
 * @example
 * const prefetchContact = usePrefetchContact()
 * <div onMouseEnter={() => prefetchContact(contactId)}>...</div>
 */
export function usePrefetchContact() {
  const queryClient = useQueryClient();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedIdsRef = useRef<Set<string>>(new Set());

  return useCallback(
    (contactId: string) => {
      // Skip if already prefetched in this session
      if (prefetchedIdsRef.current.has(contactId)) {
        return;
      }

      // Clear any pending debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Debounce the prefetch to avoid excessive requests during scroll
      debounceTimerRef.current = setTimeout(() => {
        // Mark as prefetched
        prefetchedIdsRef.current.add(contactId);

        // Prefetch contact details
        queryClient.prefetchQuery({
          queryKey: queryKeys.contacts.detail(contactId),
          staleTime: 30 * 1000, // Consider data fresh for 30 seconds
        });

        // Optionally prefetch messages for this contact
        queryClient.prefetchQuery({
          queryKey: queryKeys.conversations.detail(contactId),
          staleTime: 10 * 1000, // Messages are more volatile
        });
      }, 100); // 100ms debounce
    },
    [queryClient],
  );
}

/**
 * Generic prefetch hook that works with any query options
 * Memoizes to prevent unnecessary re-fetches
 *
 * @example
 * const prefetch = usePrefetchQuery({
 *   queryKey: ['users', userId],
 *   queryFn: () => fetchUser(userId),
 * })
 *
 * <div onMouseEnter={prefetch}>...</div>
 */
export function usePrefetchQuery<TData>(queryOptions: {
  queryKey: readonly unknown[];
  queryFn?: () => Promise<TData>;
  staleTime?: number;
}) {
  const queryClient = useQueryClient();
  const hasPrefetchedRef = useRef(false);

  return useCallback(() => {
    if (hasPrefetchedRef.current) return;

    hasPrefetchedRef.current = true;
    queryClient.prefetchQuery({
      queryKey: queryOptions.queryKey,
      queryFn: queryOptions.queryFn,
      staleTime: queryOptions.staleTime ?? 30 * 1000,
    });
  }, [
    queryClient,
    queryOptions.queryKey,
    queryOptions.queryFn,
    queryOptions.staleTime,
  ]);
}

/**
 * Standard domains that use the QueryKeyFactory pattern with detail() method
 */
type StandardDomain =
  | "contacts"
  | "groups"
  | "messages"
  | "conversations"
  | "tags"
  | "whatsapp"
  | "privateNotes"
  | "sharedNotes"
  | "assignmentHistory"
  | "chats"
  | "search"
  | "status"
  | "export";

/**
 * Prefetches data for a list of entity IDs in batch
 * Useful for preloading data visible in a virtualized list
 *
 * @example
 * const prefetchBatch = usePrefetchBatch('contacts')
 * prefetchBatch(['id1', 'id2', 'id3'])
 */
export function usePrefetchBatch(domain: StandardDomain) {
  const queryClient = useQueryClient();
  const prefetchedIdsRef = useRef<Set<string>>(new Set());

  return useCallback(
    (ids: string[]) => {
      const newIds = ids.filter((id) => !prefetchedIdsRef.current.has(id));

      if (newIds.length === 0) return;

      // Mark all as prefetched immediately to prevent duplicate requests
      for (const id of newIds) {
        prefetchedIdsRef.current.add(id);
      }

      // Prefetch each in parallel
      for (const id of newIds) {
        queryClient.prefetchQuery({
          queryKey: queryKeys[domain].detail(id),
          staleTime: 30 * 1000,
        });
      }
    },
    [queryClient, domain],
  );
}
