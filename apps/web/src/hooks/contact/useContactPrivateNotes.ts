import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "../query-keys";

/**
 * Private note for a contact
 */
export interface PrivateNote {
  id: string;
  contactId: string;
  userId: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook to fetch private notes for a contact (multiple notes)
 */
export function usePrivateNotes(contactId: string | null) {
  return useQuery({
    queryKey: queryKeys.privateNotes.detail(contactId ?? ""),
    queryFn: async () => {
      if (!contactId) throw new Error("No contact ID provided");
      const response = await api.get<{
        data: PrivateNote[];
        pagination: {
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
      }>(`/contacts/${contactId}/notes/private`);
      return response;
    },
    enabled: !!contactId,
    staleTime: 30_000,
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to create a private note (legacy - for backwards compatibility)
 */
export function useUpdatePrivateNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      content,
    }: {
      contactId: string;
      content: string;
    }) => {
      const response = await api.post<PrivateNote>(
        `/contacts/${contactId}/notes/private`,
        {
          content,
        },
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.privateNotes.detail(variables.contactId),
      });
    },
  });
}

/**
 * Hook to create a new private note
 */
export function useCreatePrivateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      content,
    }: {
      contactId: string;
      content: string;
    }) => {
      const response = await api.post<PrivateNote>(
        `/contacts/${contactId}/notes/private`,
        {
          content,
        },
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.privateNotes.detail(variables.contactId),
      });
    },
  });
}

/**
 * Hook to update an existing private note
 */
export function useUpdatePrivateNote() {
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
      const response = await api.put<PrivateNote>(
        `/contacts/${contactId}/notes/private/${noteId}`,
        { content },
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.privateNotes.detail(variables.contactId),
      });
    },
  });
}

/**
 * Hook to delete a private note
 */
export function useDeletePrivateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      noteId,
    }: {
      contactId: string;
      noteId: string;
    }) => {
      await api.delete(`/contacts/${contactId}/notes/private/${noteId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.privateNotes.detail(variables.contactId),
      });
    },
  });
}
