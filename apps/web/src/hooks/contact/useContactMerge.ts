import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api/client";
import {
  getMergeSuggestions,
  type MergeSuggestion,
  mergeContact,
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
