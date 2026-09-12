import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api/client";
import { type CustomerChat, getCustomerChats } from "@/lib/api/contacts";
import { queryKeys } from "../query-keys";

/**
 * The threads this customer can be reached on.
 *
 * Returns more than one entry only after a merge. A 404 means the chat is not
 * visible to this user - restricted members see only threads they are assigned
 * - and is answered with an empty list rather than an error, because the
 * switcher simply has nothing to offer in that case.
 */
export function useCustomerChats(contactId: string | null | undefined) {
  return useQuery<CustomerChat[]>({
    queryKey: [...queryKeys.contacts.detail(contactId ?? ""), "chats"],
    queryFn: async () => {
      try {
        return await getCustomerChats(contactId!);
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 404) {
          return [];
        }
        throw error;
      }
    },
    enabled: Boolean(contactId),
    // Held long because the answer only changes when a merge does. Every chat
    // open asks once; on a workspace with no merges the answer is one thread
    // and the switcher renders nothing.
    staleTime: 300_000,
  });
}
