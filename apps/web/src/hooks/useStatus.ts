import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildQueryString } from "@/lib/api";
import { queryKeys } from "./query-keys";

export interface StatusUpdate {
  id: string;
  statusId: string;
  mediaType: string | null;
  mediaUrl: string | null;
  caption: string | null;
  timestamp: string;
  expiresAt: string;
}

export interface ContactStatus {
  jid: string;
  statuses: StatusUpdate[];
}

export interface StatusStats {
  activeStatuses: number;
  contactsWithStatus: number;
  totalStatusesReceived: number;
}

export type StatusType = "text" | "image" | "video";

export interface PostStatusInput {
  type: StatusType;
  content?: string;
  mediaUrl?: string;
}

export interface PostStatusResponse {
  success: boolean;
  status: {
    id: string;
    type: StatusType;
    content: string | null;
    mediaUrl: string | null;
    timestamp: string;
    expiresAt: string;
  };
}

export interface MyStatusResponse {
  data: StatusUpdate[];
  count: number;
}

/**
 * Extended query keys for status with custom patterns
 * Uses the base queryKeys.status and extends with status-specific keys
 */
export const statusKeys = {
  ...queryKeys.status,
  list: (filters?: { limit?: number; offset?: number }) =>
    [...queryKeys.status.lists(), filters] as const,
  contact: (jid: string) => [...queryKeys.status.all, "contact", jid] as const,
  stats: () => [...queryKeys.status.all, "stats"] as const,
  my: () => [...queryKeys.status.all, "my"] as const,
};

/**
 * Hook to fetch all status updates
 */
export function useStatusUpdates(limit: number = 50, offset: number = 0) {
  return useQuery<ContactStatus[], Error>({
    queryKey: statusKeys.list({ limit, offset }),
    queryFn: async () => {
      const queryString = buildQueryString({ limit, offset });
      const result = await api.get<{ data: ContactStatus[] }>(
        `/status${queryString}`,
      );
      return result.data;
    },
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 1000 * 60, // Refetch every minute for expiring statuses
  });
}

/**
 * Hook to fetch status updates from a specific contact
 */
export function useContactStatus(jid: string | null) {
  return useQuery<ContactStatus, Error>({
    queryKey: statusKeys.contact(jid || ""),
    queryFn: async () => {
      if (!jid) {
        throw new Error("No JID provided");
      }
      return api.get<ContactStatus>(`/status/${encodeURIComponent(jid)}`);
    },
    enabled: !!jid,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to fetch status statistics
 */
export function useStatusStats() {
  return useQuery<StatusStats, Error>({
    queryKey: statusKeys.stats(),
    queryFn: async () => {
      return api.get<StatusStats>("/status/stats/overview");
    },
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to fetch my own status updates
 */
export function useMyStatus() {
  return useQuery<MyStatusResponse, Error>({
    queryKey: statusKeys.my(),
    queryFn: async () => {
      return api.get<MyStatusResponse>("/status/my");
    },
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to post a new status update
 */
export function usePostStatus() {
  const queryClient = useQueryClient();

  return useMutation<PostStatusResponse, Error, PostStatusInput>({
    mutationFn: async (input: PostStatusInput) => {
      return api.post<PostStatusResponse>("/status", input);
    },
    onSuccess: () => {
      // Invalidate status queries to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.status.all });
    },
  });
}

/**
 * Hook to delete a status update
 */
export function useDeleteStatus() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (statusId: string) => {
      return api.delete<{ success: boolean }>(`/status/${statusId}`);
    },
    onSuccess: () => {
      // Invalidate status queries to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.status.all });
    },
  });
}
