import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "../query-keys";

/**
 * Assignment history entry
 */
export interface AssignmentHistoryEntry {
  id: string;
  assignedTo: string;
  assignedToName: string;
  assignedBy: string;
  assignedByName: string;
  assignedAt: string;
  unassignedAt: string | null;
  isActive: boolean;
}

/**
 * Hook to assign current user to a contact
 */
export function useAssignContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contactId: string) => {
      await api.post(`/contacts/${contactId}/assign`, {});
    },
    onSuccess: (_, contactId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contacts.detail(contactId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.assignmentHistory.detail(contactId),
      });
      // Chat list rows show assignment (assigned-to-me filters, badges) - a
      // realtime broadcast covers other clients, but this client's own
      // mutation response can land before that broadcast is processed.
      queryClient.invalidateQueries({
        queryKey: queryKeys.chats.lists(),
      });
    },
  });
}

/**
 * Hook to unassign contact
 */
export function useUnassignContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contactId: string) => {
      await api.delete(`/contacts/${contactId}/assign`);
    },
    onSuccess: (_, contactId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contacts.detail(contactId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.assignmentHistory.detail(contactId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.chats.lists(),
      });
    },
  });
}

/**
 * Hook to fetch assignment history for a contact
 */
export function useAssignmentHistory(contactId: string | null) {
  return useQuery({
    queryKey: queryKeys.assignmentHistory.detail(contactId ?? ""),
    queryFn: async () => {
      if (!contactId) throw new Error("No contact ID provided");
      return api.get<AssignmentHistoryEntry[]>(
        `/contacts/${contactId}/assignments`,
      );
    },
    enabled: !!contactId,
    staleTime: 30_000, // 30 seconds
    gcTime: 300_000, // 5 minutes
  });
}
