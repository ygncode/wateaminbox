import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CreateQuickReplyInput,
  createQuickReply,
  deleteQuickReply,
  getQuickReplies,
  getQuickReplyByShortcut,
  type QuickReply,
  type QuickReplyListParams,
  type UpdateQuickReplyInput,
  updateQuickReply,
} from "@/lib/api";

/**
 * Hook for managing quick replies
 */
export function useQuickReplies(params: QuickReplyListParams = {}) {
  const queryClient = useQueryClient();

  // Fetch quick replies list
  const {
    data: quickRepliesData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["quick-replies", params],
    queryFn: () => getQuickReplies(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Create quick reply
  const createMutation = useMutation({
    mutationFn: createQuickReply,
    onSuccess: (newQuickReply) => {
      // Add to the list
      queryClient.setQueryData(
        ["quick-replies", params],
        (old: { data: QuickReply[]; meta: { total: number } } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: [...old.data, newQuickReply].sort((a, b) =>
              a.shortcut.localeCompare(b.shortcut),
            ),
            meta: {
              ...old.meta,
              total: old.meta.total + 1,
            },
          };
        },
      );
      // Invalidate all quick-replies queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
    },
  });

  // Update quick reply
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateQuickReplyInput }) =>
      updateQuickReply(id, input),
    onSuccess: (updatedQuickReply) => {
      // Update in the list
      queryClient.setQueryData(
        ["quick-replies", params],
        (old: { data: QuickReply[]; meta: unknown } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data
              .map((qr) =>
                qr.id === updatedQuickReply.id ? updatedQuickReply : qr,
              )
              .sort((a, b) => a.shortcut.localeCompare(b.shortcut)),
          };
        },
      );
      // Invalidate to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
    },
  });

  // Delete quick reply
  const deleteMutation = useMutation({
    mutationFn: deleteQuickReply,
    onSuccess: (_, quickReplyId) => {
      // Remove from the list
      queryClient.setQueryData(
        ["quick-replies", params],
        (old: { data: QuickReply[]; meta: { total: number } } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((qr) => qr.id !== quickReplyId),
            meta: {
              ...old.meta,
              total: Math.max(0, old.meta.total - 1),
            },
          };
        },
      );
      // Invalidate to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
    },
  });

  const quickReplies = quickRepliesData?.data || [];
  const meta = quickRepliesData?.meta || { total: 0, limit: 50, offset: 0 };

  return {
    // Data
    quickReplies,
    total: meta.total,
    hasMore: meta.offset + meta.limit < meta.total,

    // Loading states
    isLoading,

    // Errors
    error,

    // Actions
    create: (input: CreateQuickReplyInput) => createMutation.mutateAsync(input),
    update: (id: string, input: UpdateQuickReplyInput) =>
      updateMutation.mutateAsync({ id, input }),
    delete: (id: string) => deleteMutation.mutateAsync(id),
    refresh: refetch,

    // Mutation states
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

/**
 * Hook for searching quick replies by shortcut (for autocomplete in message composer)
 */
export function useQuickReplySearch(shortcut: string) {
  const { data: quickReply, isLoading } = useQuery({
    queryKey: ["quick-replies", "search", shortcut],
    queryFn: () => getQuickReplyByShortcut(shortcut),
    enabled: shortcut.length >= 1,
    staleTime: 30 * 1000, // 30 seconds
  });

  return {
    quickReply,
    isLoading,
  };
}

export default useQuickReplies;
