import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { getCompanyId } from "@/lib/api/client";
import {
  applyLabelToContact,
  autoCreateTagsFromLabels,
  getLabelSyncStatus,
  getTagsWithLabelStatus,
  getWhatsAppLabels,
  linkTagToLabel,
  removeLabelFromContact,
  triggerLabelSync,
  unlinkTagFromLabel,
} from "@/lib/api/labels";
import type {
  LabelSyncStatus,
  TagWithLabelStatus,
  WhatsAppLabel,
} from "@/lib/api/types";
import {
  useInvalidate,
  useInvalidateMultiple,
  useQueryInvalidation,
} from "./query";
import { queryKeys } from "./query-keys";

// Query keys for labels
export const labelKeys = {
  get all() {
    return ["labels", getCompanyId()] as const;
  },
  list: (connectionId: string) =>
    ["labels", getCompanyId(), connectionId, "list"] as const,
  status: (connectionId: string) =>
    ["labels", getCompanyId(), connectionId, "status"] as const,
  tagsWithStatus: (connectionId: string) =>
    ["labels", getCompanyId(), connectionId, "tags-with-status"] as const,
};

/**
 * Hook for fetching WhatsApp labels
 */
export function useWhatsAppLabels(connectionId: string) {
  return useInfiniteQuery({
    queryKey: labelKeys.list(connectionId),
    queryFn: ({ pageParam }) => getWhatsAppLabels(connectionId, 50, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!connectionId,
  });
}

/**
 * Hook for fetching label sync status
 */
export function useLabelSyncStatus(connectionId: string) {
  return useQuery({
    queryKey: labelKeys.status(connectionId),
    queryFn: () => getLabelSyncStatus(connectionId),
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!connectionId,
  });
}

/**
 * Hook for fetching tags with their label sync status
 */
export function useTagsWithLabelStatus(connectionId: string) {
  return useQuery({
    queryKey: labelKeys.tagsWithStatus(connectionId),
    queryFn: () => getTagsWithLabelStatus(connectionId),
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!connectionId,
  });
}

/**
 * Hook for triggering a label sync from WhatsApp
 */
export function useTriggerLabelSync() {
  const invalidateLabels = useInvalidate(labelKeys.all);

  return useMutation({
    mutationFn: (connectionId: string) => triggerLabelSync(connectionId),
    onSuccess: invalidateLabels,
  });
}

/**
 * Hook for linking a tag to a WhatsApp label
 */
export function useLinkTagToLabel() {
  const invalidateLabelsAndTags = useInvalidateMultiple([
    labelKeys.all,
    queryKeys.tags.all,
  ]);

  return useMutation({
    mutationFn: ({
      labelId,
      tagId,
      connectionId,
    }: {
      labelId: string;
      tagId: string;
      connectionId: string;
    }) => linkTagToLabel(labelId, tagId, connectionId),
    onSuccess: invalidateLabelsAndTags,
  });
}

/**
 * Hook for unlinking a tag from a WhatsApp label
 */
export function useUnlinkTagFromLabel() {
  const invalidateLabelsAndTags = useInvalidateMultiple([
    labelKeys.all,
    queryKeys.tags.all,
  ]);

  return useMutation({
    mutationFn: ({
      labelId,
      connectionId,
    }: {
      labelId: string;
      connectionId: string;
    }) => unlinkTagFromLabel(labelId, connectionId),
    onSuccess: invalidateLabelsAndTags,
  });
}

/**
 * Hook for auto-creating tags from unlinked WhatsApp labels
 */
export function useAutoCreateTagsFromLabels() {
  const invalidateLabelsAndTags = useInvalidateMultiple([
    labelKeys.all,
    queryKeys.tags.all,
  ]);

  return useMutation({
    mutationFn: (connectionId: string) =>
      autoCreateTagsFromLabels(connectionId),
    onSuccess: invalidateLabelsAndTags,
  });
}

/**
 * Hook for applying a WhatsApp label to a contact
 */
export function useApplyLabelToContact() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: ({
      labelId,
      contactId,
    }: {
      labelId: string;
      contactId: string;
    }) => applyLabelToContact(labelId, contactId),
    onSuccess: (_, { contactId }) => {
      invalidate(queryKeys.contacts.detail(contactId));
    },
  });
}

/**
 * Hook for removing a WhatsApp label from a contact
 */
export function useRemoveLabelFromContact() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: ({
      labelId,
      contactId,
    }: {
      labelId: string;
      contactId: string;
    }) => removeLabelFromContact(labelId, contactId),
    onSuccess: (_, { contactId }) => {
      invalidate(queryKeys.contacts.detail(contactId));
    },
  });
}

/**
 * Combined hook for label management
 */
export function useLabels(connectionId: string) {
  const invalidateLabels = useInvalidate(labelKeys.all);

  const labelsQuery = useWhatsAppLabels(connectionId);
  const statusQuery = useLabelSyncStatus(connectionId);
  const tagsWithStatusQuery = useTagsWithLabelStatus(connectionId);

  const syncMutation = useTriggerLabelSync();
  const linkMutation = useLinkTagToLabel();
  const unlinkMutation = useUnlinkTagFromLabel();
  const autoCreateMutation = useAutoCreateTagsFromLabels();

  return {
    // Data
    labels: labelsQuery.data?.pages.flatMap((page) => page.data) || [],
    status: statusQuery.data,
    tagsWithStatus: tagsWithStatusQuery.data || [],

    // Loading states
    isLoading:
      labelsQuery.isLoading ||
      statusQuery.isLoading ||
      tagsWithStatusQuery.isLoading,
    isLabelsLoading: labelsQuery.isLoading,
    isStatusLoading: statusQuery.isLoading,
    isTagsLoading: tagsWithStatusQuery.isLoading,

    // Errors
    error: labelsQuery.error || statusQuery.error || tagsWithStatusQuery.error,

    // Actions
    sync: () => syncMutation.mutateAsync(connectionId),
    link: (labelId: string, tagId: string) =>
      linkMutation.mutateAsync({ labelId, tagId, connectionId }),
    unlink: (labelId: string) =>
      unlinkMutation.mutateAsync({ labelId, connectionId }),
    autoCreateTags: () => autoCreateMutation.mutateAsync(connectionId),
    loadMore: labelsQuery.fetchNextPage,
    refresh: invalidateLabels,

    // Mutation states
    isSyncing: syncMutation.isPending,
    isLinking: linkMutation.isPending,
    isUnlinking: unlinkMutation.isPending,
    isAutoCreating: autoCreateMutation.isPending,
    isLoadingMore: labelsQuery.isFetchingNextPage,
    hasMore: labelsQuery.hasNextPage,
  };
}

// Type exports
export type { WhatsAppLabel, LabelSyncStatus, TagWithLabelStatus };
