import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Contact detail from API with extended fields
 */
export interface ContactDetail {
  id: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  profilePictureUrl: string | null;
  notesShared: string | null;
  createdAt: string;
  updatedAt: string;
  assignment: {
    assignedTo: string;
    assignedToName: string;
    assignedBy: string;
    assignedByName: string;
    assignedAt: string;
  } | null;
  tags: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
}

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
 * Tag definition
 */
export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdBy: string | null;
  createdAt: string;
}

/**
 * Hook to fetch a single contact's details
 */
export function useContact(contactId: string | null) {
  return useQuery({
    queryKey: ["contact", contactId],
    queryFn: async () => {
      if (!contactId) throw new Error("No contact ID provided");
      const response = await api.get<ContactDetail>(`/contacts/${contactId}`);
      return response;
    },
    enabled: !!contactId,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to update a contact's custom name or shared notes
 */
export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      customName,
      notesShared,
    }: {
      contactId: string;
      customName?: string;
      notesShared?: string;
    }) => {
      const response = await api.patch<ContactDetail>(
        `/contacts/${contactId}`,
        {
          customName,
          notesShared,
        },
      );
      return response;
    },
    onSuccess: (data, variables) => {
      // Update the contact cache
      queryClient.setQueryData(
        ["contact", variables.contactId],
        (old: ContactDetail | undefined) => {
          if (!old) return data;
          return { ...old, ...data };
        },
      );
      // Invalidate the contacts list to reflect changes
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

/**
 * Hook to fetch private notes for a contact (multiple notes)
 */
export function usePrivateNotes(contactId: string | null) {
  return useQuery({
    queryKey: ["privateNotes", contactId],
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
        queryKey: ["privateNotes", variables.contactId],
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
        queryKey: ["privateNotes", variables.contactId],
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
        queryKey: ["privateNotes", variables.contactId],
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
        queryKey: ["privateNotes", variables.contactId],
      });
    },
  });
}

/**
 * Hook to fetch shared notes for a contact (multiple notes)
 */
export function useSharedNotes(contactId: string | null) {
  return useQuery({
    queryKey: ["sharedNotes", contactId],
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
        queryKey: ["sharedNotes", variables.contactId],
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
        queryKey: ["sharedNotes", variables.contactId],
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
        queryKey: ["sharedNotes", variables.contactId],
      });
    },
  });
}

/**
 * Hook to add a tag to a contact
 */
export function useAddContactTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      tagId,
    }: {
      contactId: string;
      tagId: string;
    }) => {
      await api.post(`/contacts/${contactId}/tags`, { tagId });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["contact", variables.contactId],
      });
    },
  });
}

/**
 * Hook to remove a tag from a contact
 */
export function useRemoveContactTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      tagId,
    }: {
      contactId: string;
      tagId: string;
    }) => {
      await api.delete(`/contacts/${contactId}/tags/${tagId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["contact", variables.contactId],
      });
    },
  });
}

/**
 * Hook to fetch all available tags
 */
export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const response = await api.get<{ data: Tag[] }>("/tags");
      return response.data;
    },
    staleTime: 60_000, // 1 minute
  });
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
      queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      queryClient.invalidateQueries({
        queryKey: ["assignmentHistory", contactId],
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
      queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      queryClient.invalidateQueries({
        queryKey: ["assignmentHistory", contactId],
      });
    },
  });
}

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
 * Hook to fetch assignment history for a contact
 */
export function useAssignmentHistory(contactId: string | null) {
  return useQuery({
    queryKey: ["assignmentHistory", contactId],
    queryFn: async () => {
      if (!contactId) throw new Error("No contact ID provided");
      const response = await api.get<{ data: AssignmentHistoryEntry[] }>(
        `/contacts/${contactId}/assignments`,
      );
      return response.data;
    },
    enabled: !!contactId,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Input for creating a new contact
 */
export interface CreateContactInput {
  phoneNumber: string;
  customName?: string;
  notesShared?: string;
}

/**
 * Response from creating a contact
 */
export interface CreateContactResponse {
  id: string;
  jid: string;
  phoneNumber: string;
  customName: string | null;
  displayName: string;
  notesShared: string | null;
  isGroup: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook to create a new contact by phone number
 */
export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      const response = await api.post<CreateContactResponse>(
        "/contacts",
        input,
      );
      return response;
    },
    onSuccess: () => {
      // Invalidate contacts list to show the new contact
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
