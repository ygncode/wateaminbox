/**
 * Bulk broadcast job hooks.
 * Toasts stay in components; mutations invalidate the bulk-jobs domain and
 * the realtime bulk_job:updated event keeps other clients fresh.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelBulkJob,
  createBulkJob,
  type CreateBulkJobInput,
  getBulkJob,
  getBulkJobRecipients,
  getBulkJobs,
  previewBulkJob,
  type PreviewBulkJobInput,
} from "../lib/api";
import { queryKeys } from "./query-keys";

export function useBulkJobs(params: { limit: number; offset: number }) {
  return useQuery({
    queryKey: queryKeys.bulkJobs.list(params),
    queryFn: () => getBulkJobs(params),
    staleTime: 15_000,
  });
}

export function useBulkJob(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bulkJobs.detail(id ?? ""),
    queryFn: () => getBulkJob(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useBulkJobRecipients(
  id: string | undefined,
  params: { limit: number; offset: number; status?: string },
) {
  return useQuery({
    queryKey: [...queryKeys.bulkJobs.detail(id ?? ""), "recipients", params],
    queryFn: () => getBulkJobRecipients(id as string, params),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function usePreviewBulkJob() {
  return useMutation({
    mutationFn: (input: PreviewBulkJobInput) => previewBulkJob(input),
  });
}

export function useCreateBulkJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBulkJobInput) => createBulkJob(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bulkJobs.all });
    },
  });
}

export function useCancelBulkJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelBulkJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bulkJobs.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.scheduledMessages.all,
      });
    },
  });
}
