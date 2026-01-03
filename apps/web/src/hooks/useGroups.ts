import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * Group participant from API
 */
export interface GroupParticipant {
  jid: string;
  isAdmin: boolean;
  joinedAt: string | null;
}

/**
 * Tag attached to a group
 */
export interface GroupTag {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Group list item from API
 */
export interface GroupListItem {
  id: string;
  jid: string;
  name: string | null;
  displayName: string;
  description: string | null;
  participantCount: number | null;
  profilePictureUrl: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

/**
 * Full group detail from API
 */
export interface GroupDetail {
  id: string;
  jid: string;
  name: string | null;
  displayName: string;
  customName: string | null;
  description: string | null;
  profilePictureUrl: string | null;
  participantCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  participants: GroupParticipant[];
  tags: GroupTag[];
}

/**
 * Groups list response from API
 */
interface GroupsListResponse {
  data: GroupListItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Query key factory for group-related queries
 */
export const groupKeys = {
  all: ["groups"] as const,
  lists: () => [...groupKeys.all, "list"] as const,
  list: (filters: { search?: string; limit?: number; offset?: number }) =>
    [...groupKeys.lists(), filters] as const,
  details: () => [...groupKeys.all, "detail"] as const,
  detail: (id: string) => [...groupKeys.details(), id] as const,
};

/**
 * Hook to fetch groups list with optional search, limit, and offset
 */
export function useGroups(search?: string, limit?: number, offset?: number) {
  return useQuery({
    queryKey: groupKeys.list({ search, limit, offset }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search?.trim()) {
        params.set("search", search);
      }
      if (limit !== undefined) {
        params.set("limit", String(limit));
      }
      if (offset !== undefined) {
        params.set("offset", String(offset));
      }

      const queryString = params.toString();
      const endpoint = queryString ? `/groups?${queryString}` : "/groups";
      const response = await api.get<GroupsListResponse>(endpoint);
      return response;
    },
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to fetch a single group with participants
 */
export function useGroup(groupId: string | null) {
  return useQuery({
    queryKey: groupKeys.detail(groupId || ""),
    queryFn: async () => {
      if (!groupId) throw new Error("No group ID provided");
      const response = await api.get<GroupDetail>(`/groups/${groupId}`);
      return response;
    },
    enabled: !!groupId,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to update a group's custom name
 */
export function useUpdateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      customName,
    }: {
      groupId: string;
      customName?: string;
    }) => {
      const response = await api.patch<{
        id: string;
        customName: string | null;
        updatedAt: string;
      }>(`/groups/${groupId}`, { customName });
      return response;
    },
    onSuccess: (data, variables) => {
      // Update the group detail cache
      queryClient.setQueryData(
        groupKeys.detail(variables.groupId),
        (old: GroupDetail | undefined) => {
          if (!old) return old;
          return {
            ...old,
            customName: data.customName,
            displayName: data.customName || old.name || "Unknown Group",
            updatedAt: data.updatedAt,
          };
        },
      );
      // Invalidate the groups list to reflect changes
      queryClient.invalidateQueries({ queryKey: groupKeys.lists() });
    },
  });
}

/**
 * Admin status response from API
 */
export interface GroupAdminStatus {
  isAdmin: boolean;
  connectionJid: string | null;
  reason?: string;
}

/**
 * Hook to check if current user is admin of a group
 */
export function useGroupAdminStatus(groupId: string | null) {
  return useQuery({
    queryKey: [...groupKeys.detail(groupId || ""), "admin-status"],
    queryFn: async () => {
      if (!groupId) throw new Error("No group ID provided");
      const response = await api.get<GroupAdminStatus>(
        `/groups/${groupId}/admin-status`,
      );
      return response;
    },
    enabled: !!groupId,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to promote a participant to admin
 */
export function usePromoteParticipant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      participantJid,
    }: {
      groupId: string;
      participantJid: string;
    }) => {
      const response = await api.post<{
        success: boolean;
        message: string;
        participantJid: string;
      }>(`/groups/${groupId}/participants/${encodeURIComponent(participantJid)}/promote`);
      return response;
    },
    onSuccess: (_data, variables) => {
      // Update the group detail cache to reflect admin change
      queryClient.setQueryData(
        groupKeys.detail(variables.groupId),
        (old: GroupDetail | undefined) => {
          if (!old) return old;
          return {
            ...old,
            participants: old.participants.map((p) =>
              p.jid === variables.participantJid ? { ...p, isAdmin: true } : p,
            ),
          };
        },
      );
      toast.success("Participant promoted to admin");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to promote participant");
    },
  });
}

/**
 * Hook to demote an admin to regular participant
 */
export function useDemoteParticipant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      participantJid,
    }: {
      groupId: string;
      participantJid: string;
    }) => {
      const response = await api.post<{
        success: boolean;
        message: string;
        participantJid: string;
      }>(`/groups/${groupId}/participants/${encodeURIComponent(participantJid)}/demote`);
      return response;
    },
    onSuccess: (_data, variables) => {
      // Update the group detail cache to reflect admin change
      queryClient.setQueryData(
        groupKeys.detail(variables.groupId),
        (old: GroupDetail | undefined) => {
          if (!old) return old;
          return {
            ...old,
            participants: old.participants.map((p) =>
              p.jid === variables.participantJid ? { ...p, isAdmin: false } : p,
            ),
          };
        },
      );
      toast.success("Admin demoted to regular participant");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to demote admin");
    },
  });
}

/**
 * Hook to remove a participant from the group
 */
export function useRemoveParticipant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      participantJid,
    }: {
      groupId: string;
      participantJid: string;
    }) => {
      const response = await api.delete<{
        success: boolean;
        message: string;
        participantJid: string;
      }>(`/groups/${groupId}/participants/${encodeURIComponent(participantJid)}`);
      return response;
    },
    onSuccess: (_data, variables) => {
      // Update the group detail cache to remove participant
      queryClient.setQueryData(
        groupKeys.detail(variables.groupId),
        (old: GroupDetail | undefined) => {
          if (!old) return old;
          return {
            ...old,
            participants: old.participants.filter(
              (p) => p.jid !== variables.participantJid,
            ),
            participantCount: Math.max(0, old.participantCount - 1),
          };
        },
      );
      toast.success("Participant removed from group");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove participant");
    },
  });
}

/**
 * Hook to update group settings (name, description)
 */
export function useUpdateGroupSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      name,
      description,
    }: {
      groupId: string;
      name?: string;
      description?: string;
    }) => {
      const response = await api.patch<{
        success: boolean;
        message: string;
        name: string | null;
        description: string | null;
      }>(`/groups/${groupId}/settings`, { name, description });
      return response;
    },
    onSuccess: (data, variables) => {
      // Update the group detail cache
      queryClient.setQueryData(
        groupKeys.detail(variables.groupId),
        (old: GroupDetail | undefined) => {
          if (!old) return old;
          return {
            ...old,
            name: data.name,
            description: data.description,
            displayName: old.customName || data.name || "Unknown Group",
          };
        },
      );
      // Invalidate the groups list to reflect changes
      queryClient.invalidateQueries({ queryKey: groupKeys.lists() });
      toast.success("Group settings updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update group settings");
    },
  });
}
