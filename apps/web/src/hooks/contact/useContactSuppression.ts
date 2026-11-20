import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "../query-keys";

/** Channel-neutral block / mute state of one customer (every channel). */
export interface ContactSuppressionStatus {
  contactId: string;
  /** Whether the workspace enforces suppressions yet (operator switch). */
  enforced: boolean;
  blocked: boolean;
  muted: { id: string; expiresAt: string | null } | null;
  channels: Array<{
    channel: string;
    /** The provider itself has this person blocked on this channel. */
    providerBlocked: boolean;
    /** The person blocked, left or unsubscribed from us on this channel. */
    unreachable: boolean;
    /** Inbound messages dropped while blocked. */
    dropped: number;
    lastDroppedAt: string | null;
  }>;
}

export type SuppressionScope = "block" | "mute_inbound";

export const suppressionKey = (contactId: string) =>
  [...queryKeys.contacts.detail(contactId), "suppressions"] as const;

export function useContactSuppression(contactId: string | null) {
  return useQuery({
    queryKey: suppressionKey(contactId ?? ""),
    enabled: Boolean(contactId),
    queryFn: () =>
      api.get<ContactSuppressionStatus>(`/contacts/${contactId}/suppressions`),
  });
}

/**
 * Block or mute a customer on every channel, or lift it. Not optimistic: a
 * block is a deliberate, audited decision, so the panel waits for the server.
 */
export function useSetContactSuppression(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scope: SuppressionScope;
      on: boolean;
      durationMinutes?: number;
    }) =>
      input.on
        ? api.post(`/contacts/${contactId}/suppressions`, {
            scope: input.scope,
            ...(input.durationMinutes
              ? { durationMinutes: input.durationMinutes }
              : {}),
          })
        : api.delete(`/contacts/${contactId}/suppressions/${input.scope}`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: suppressionKey(contactId) });
      // The legacy isBlocked flag and the composer gate read the contact.
      queryClient.invalidateQueries({
        queryKey: queryKeys.contacts.detail(contactId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.lists() });
    },
  });
}
