import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api/client";
import {
  getMergeHistory,
  getMergeSuggestions,
  type MergeHistoryEntry,
  type MergeSuggestion,
  mergeContact,
  unmergeContact,
} from "@/lib/api/contacts";
import { queryKeys } from "../query-keys";

/**
 * Merge candidates for a customer.
 *
 * The endpoint is admin/owner only and returns 403 otherwise, which is not an
 * error worth surfacing: a member simply has no merge section. A workspace
 * that may not execute merges can still read suggestions, so this query is
 * deliberately not gated on the merge flag.
 */
export function useMergeSuggestions(contactId: string | null | undefined) {
  return useQuery<MergeSuggestion[]>({
    queryKey: [
      ...queryKeys.contacts.detail(contactId ?? ""),
      "merge-suggestions",
    ],
    queryFn: async () => {
      try {
        return await getMergeSuggestions(contactId!);
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 403) {
          return [];
        }
        throw error;
      }
    },
    enabled: Boolean(contactId),
    staleTime: 60_000,
  });
}

export function useMergeContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      sourceContactId,
      reason,
    }: {
      contactId: string;
      sourceContactId: string;
      reason: string;
    }) => mergeContact(contactId, sourceContactId, reason),
    onSuccess: () => {
      // A merge changes which customers exist and which endpoints they own, so
      // contact lists, the merged-away profile, and search all go stale at once.
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}

/**
 * What was merged into this customer.
 *
 * A merge is otherwise invisible after the fact - the merged-away customer
 * stops appearing anywhere - so this is the only place an operator can see
 * which records were folded together and reverse one. Admin/owner only, and a
 * 403 means the section simply does not apply to this member.
 */
export function useMergeHistory(contactId: string | null | undefined) {
  return useQuery<MergeHistoryEntry[]>({
    queryKey: [...queryKeys.contacts.detail(contactId ?? ""), "merge-history"],
    queryFn: async () => {
      try {
        return await getMergeHistory(contactId!);
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          (error.statusCode === 403 || error.statusCode === 404)
        ) {
          return [];
        }
        throw error;
      }
    },
    enabled: Boolean(contactId),
    staleTime: 60_000,
  });
}

export function useUnmergeContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      mergeEventId,
      reason,
    }: {
      mergeEventId: string;
      reason: string;
    }) => unmergeContact(mergeEventId, reason),
    onSuccess: () => {
      // A correction revives a customer and moves endpoints back, so the same
      // caches a merge invalidated are stale again.
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}
