import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyLabelToContact,
  autoCreateTagsFromLabels,
  getLabelSyncStatus,
  getTagsWithLabelStatus,
  getWhatsAppLabels,
  type LabelSyncStatus,
  linkTagToLabel,
  removeLabelFromContact,
  type TagWithLabelStatus,
  triggerLabelSync,
  unlinkTagFromLabel,
  type WhatsAppLabel,
} from "@/lib/api";
import { queryKeys } from "./query-keys";

// Query keys for labels
export const labelKeys = {
  all: ["labels"] as const,
  list: () => [...labelKeys.all, "list"] as const,
  status: () => [...labelKeys.all, "status"] as const,
  tagsWithStatus: () => [...labelKeys.all, "tags-with-status"] as const,
};

/**
 * Hook for fetching WhatsApp labels
 */
export function useWhatsAppLabels() {
  return useQuery({
    queryKey: labelKeys.list(),
    queryFn: getWhatsAppLabels,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for fetching label sync status
 */
export function useLabelSyncStatus() {
  return useQuery({
    queryKey: labelKeys.status(),
    queryFn: getLabelSyncStatus,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook for fetching tags with their label sync status
 */
export function useTagsWithLabelStatus() {
  return useQuery({
    queryKey: labelKeys.tagsWithStatus(),
    queryFn: getTagsWithLabelStatus,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for triggering a label sync from WhatsApp
 */
export function useTriggerLabelSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerLabelSync,
    onSuccess: () => {
      // Invalidate labels and status to refresh after sync completes
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
    },
  });
}

/**
 * Hook for linking a tag to a WhatsApp label
 */
export function useLinkTagToLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ labelId, tagId }: { labelId: string; tagId: string }) =>
      linkTagToLabel(labelId, tagId),
    onSuccess: () => {
      // Invalidate labels, status, and tags queries
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
    },
  });
}

/**
 * Hook for unlinking a tag from a WhatsApp label
 */
export function useUnlinkTagFromLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) => unlinkTagFromLabel(labelId),
    onSuccess: () => {
      // Invalidate labels, status, and tags queries
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
    },
  });
}

/**
 * Hook for auto-creating tags from unlinked WhatsApp labels
 */
export function useAutoCreateTagsFromLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: autoCreateTagsFromLabels,
    onSuccess: () => {
      // Invalidate labels, status, and tags queries
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
    },
  });
}

/**
 * Hook for applying a WhatsApp label to a contact
 */
export function useApplyLabelToContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      labelId,
      contactId,
    }: {
      labelId: string;
      contactId: string;
    }) => applyLabelToContact(labelId, contactId),
    onSuccess: (_, { contactId }) => {
      // Invalidate contact data and contact tags
      queryClient.invalidateQueries({
        queryKey: queryKeys.contacts.detail(contactId),
      });
    },
  });
}

/**
 * Hook for removing a WhatsApp label from a contact
 */
export function useRemoveLabelFromContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      labelId,
      contactId,
    }: {
      labelId: string;
      contactId: string;
    }) => removeLabelFromContact(labelId, contactId),
    onSuccess: (_, { contactId }) => {
      // Invalidate contact data and contact tags
      queryClient.invalidateQueries({
        queryKey: queryKeys.contacts.detail(contactId),
      });
    },
  });
}

/**
 * Combined hook for label management
 */
export function useLabels() {
  const queryClient = useQueryClient();

  const labelsQuery = useWhatsAppLabels();
  const statusQuery = useLabelSyncStatus();
  const tagsWithStatusQuery = useTagsWithLabelStatus();

  const syncMutation = useTriggerLabelSync();
  const linkMutation = useLinkTagToLabel();
  const unlinkMutation = useUnlinkTagFromLabel();
  const autoCreateMutation = useAutoCreateTagsFromLabels();

  return {
    // Data
    labels: labelsQuery.data || [],
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
    sync: () => syncMutation.mutateAsync(undefined),
    link: (labelId: string, tagId: string) =>
      linkMutation.mutateAsync({ labelId, tagId }),
    unlink: (labelId: string) => unlinkMutation.mutateAsync(labelId),
    autoCreateTags: () => autoCreateMutation.mutateAsync(undefined),
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
    },

    // Mutation states
    isSyncing: syncMutation.isPending,
    isLinking: linkMutation.isPending,
    isUnlinking: unlinkMutation.isPending,
    isAutoCreating: autoCreateMutation.isPending,
  };
}

// Type exports
export type { WhatsAppLabel, LabelSyncStatus, TagWithLabelStatus };
