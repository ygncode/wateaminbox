import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
