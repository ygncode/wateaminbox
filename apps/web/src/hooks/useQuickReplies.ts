import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createQuickReply,
  deleteQuickReply,
  getQuickReplyLibrary,
  getQuickReplies,
  getQuickReplyByShortcut,
  updateQuickReply,
} from "@/lib/api/quick-replies";
import type {
  CreateQuickReplyInput,
  QuickReplyListParams,
  UpdateQuickReplyInput,
} from "@/lib/api/types";
import { useQueryInvalidation } from "./query";
import { queryKeys } from "./query-keys";

/**
 * Hook for managing quick replies
 */
export function useQuickReplies(params: QuickReplyListParams = {}) {
  const { invalidate } = useQueryInvalidation();

  // Fetch quick replies list
  const {
    data: quickRepliesData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.quickReplies.list(params),
    queryFn: () => getQuickReplies(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
  });

  // Create quick reply
  const createMutation = useMutation({
    mutationFn: createQuickReply,
    onSuccess: () => {
      invalidate(queryKeys.quickReplies.all);
    },
  });

  // Update quick reply
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateQuickReplyInput }) =>
      updateQuickReply(id, input),
    onSuccess: () => {
      invalidate(queryKeys.quickReplies.all);
    },
  });

  // Delete quick reply
  const deleteMutation = useMutation({
    mutationFn: deleteQuickReply,
    onSuccess: () => {
      invalidate(queryKeys.quickReplies.all);
    },
  });

  const quickReplies = quickRepliesData?.data || [];
  const pagination = quickRepliesData?.pagination || {
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  };

  return {
    // Data
    quickReplies,
    total: pagination.total,
    hasMore: pagination.hasMore,

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
 * Loads the workspace quick-reply library only while the composer picker is in
 * use. Suggestions are filtered locally so typing never waits on a request.
 */
export function useQuickReplySuggestions(enabled: boolean) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.quickReplies.library(),
    queryFn: getQuickReplyLibrary,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  return {
    quickReplies: data ?? [],
    isLoading,
    error,
  };
}

/**
 * Hook for searching quick replies by shortcut (for autocomplete in message composer)
 */
export function useQuickReplySearch(shortcut: string) {
  const { data: quickReply, isLoading } = useQuery({
    queryKey: queryKeys.quickReplies.search(shortcut),
    queryFn: () => getQuickReplyByShortcut(shortcut),
    enabled: shortcut.length >= 1,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    quickReply,
    isLoading,
  };
}

export default useQuickReplies;
