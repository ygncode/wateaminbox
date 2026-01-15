import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "../query-keys";

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
        queryKey: queryKeys.contacts.detail(variables.contactId),
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
        queryKey: queryKeys.contacts.detail(variables.contactId),
      });
    },
  });
}

/**
 * Hook to fetch all available tags
 */
export function useTags() {
  return useQuery({
    queryKey: queryKeys.tags.all,
    queryFn: async () => {
      // Tags endpoint returns paginated response { data, pagination }
      const response = await api.get<{ data: Tag[]; pagination: unknown }>(
        "/tags",
      );
      return response.data;
    },
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to create a new tag
 */
export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      color,
    }: {
      name: string;
      color?: string | null;
    }) => {
      const response = await api.post<Tag>("/tags", { name, color });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tags.all,
      });
    },
  });
}
