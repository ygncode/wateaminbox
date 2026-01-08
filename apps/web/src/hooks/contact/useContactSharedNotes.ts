import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "../query-keys";

/**
 * Shared note for a contact (visible to all team members)
 */
export interface SharedNote {
  id: string;
  contactId: string;
  userId: string;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook to fetch shared notes for a contact (multiple notes)
 */
export function useSharedNotes(contactId: string | null) {
  return useQuery({
    queryKey: queryKeys.sharedNotes.detail(contactId ?? ""),
    queryFn: async () => {
      if (!contactId) throw new Error("No contact ID provided");
      const response = await api.get<{
        data: SharedNote[];
        pagination: {
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
      }>(`/contacts/${contactId}/notes/shared`);
      return response;
    },
    enabled: !!contactId,
    staleTime: 30_000,
  });
}

/**
 * Hook to create a new shared note
 */
export function useCreateSharedNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      content,
    }: {
      contactId: string;
      content: string;
    }) => {
      const response = await api.post<SharedNote>(
        `/contacts/${contactId}/notes/shared`,
        {
          content,
        },
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sharedNotes.detail(variables.contactId),
      });
    },
  });
}

/**
 * Hook to update an existing shared note
 */
export function useUpdateSharedNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      noteId,
      content,
    }: {
      contactId: string;
      noteId: string;
      content: string;
    }) => {
      const response = await api.put<SharedNote>(
        `/contacts/${contactId}/notes/shared/${noteId}`,
        {
          content,
        },
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sharedNotes.detail(variables.contactId),
      });
    },
  });
}

/**
 * Hook to delete a shared note
 */
export function useDeleteSharedNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      noteId,
    }: {
      contactId: string;
      noteId: string;
    }) => {
      await api.delete(`/contacts/${contactId}/notes/shared/${noteId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sharedNotes.detail(variables.contactId),
      });
    },
  });
}
