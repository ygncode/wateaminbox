import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GroupJoinRequestAction,
  GroupMemberAddMode,
} from "@wateaminbox/shared";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { createQueryKeyFactory } from "./query-keys";

/**
 * Group participant from API
 */
export interface GroupParticipant {
  jid: string;
  phoneNumber: string | null;
  /** Raw WhatsApp mention tokens, including mapped private LIDs. */
  mentionIds?: string[];
  displayName: string;
  profilePictureUrl: string | null;
  isAdmin: boolean;
  isSelf: boolean;
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
  /** False once this WhatsApp account has left the group. */
  isMember: boolean;
}

/** WhatsApp's group permissions, as last confirmed by WhatsApp. */
export interface GroupSettings {
  ownerJid: string | null;
  /** Only admins can send messages. */
  isAnnounce: boolean;
  /** Only admins can edit the group's name, icon and description. */
  isLocked: boolean;
  isEphemeral: boolean;
  disappearingTimer: number;
  /** New members need admin approval. */
  isJoinApprovalRequired: boolean;
  memberAddMode: GroupMemberAddMode | null;
  isMember: boolean;
  syncedAt: string | null;
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
  /**
   * The group's real WhatsApp subject, unaliased.
   *
   * `name` above is alias-first and is a display label. Anything that writes
   * the name back to WhatsApp must use this - sending the workspace-private
   * alias would rename the group for every member.
   */
  whatsappName: string | null;
  description: string | null;
  profilePictureUrl: string | null;
  participantCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  participants: GroupParticipant[];
  tags: GroupTag[];
  connection: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    status: string;
  } | null;
  isAdmin: boolean;
  isMember: boolean;
  /** Admin, still a member, and the connection is live. */
  canAdminister: boolean;
  settings: GroupSettings;
  /** Only ever populated for admins. */
  inviteLink: string | null;
  inviteLinkUpdatedAt: string | null;
  /** Server-authored wording on what leaving does (and does not) do. */
  leaveSemantics: string;
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

/** Every group mutation answers the same way: requested, not yet applied. */
interface PendingGroupActionResponse {
  success: boolean;
  message: string;
  pending: boolean;
}

/**
 * Query key factory for group-related queries
 * Uses the standardized factory from query-keys.ts
 */
export const groupKeys = createQueryKeyFactory("groups");

const joinRequestsKey = (groupId: string) =>
  [...groupKeys.detail(groupId), "join-requests"] as const;

/**
 * Hook to fetch groups list with optional search, limit, and offset
 */
export function useGroups(
  search?: string,
  limit?: number,
  offset?: number,
  connectionId?: string,
) {
  return useQuery({
    queryKey: groupKeys.list({ search, limit, offset, connectionId }),
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
      if (connectionId) {
        params.set("connectionId", connectionId);
      }

      const queryString = params.toString();
      const endpoint = queryString ? `/groups?${queryString}` : "/groups";
      const response = await api.get<GroupsListResponse>(endpoint);
      return response;
    },
    staleTime: 30_000, // 30 seconds
    gcTime: 300_000, // 5 minutes
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
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to update a group's workspace-local alias.
 *
 * This one IS applied immediately: `customName` never leaves the workspace, so
 * there is no WhatsApp confirmation to wait for.
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
  isMember: boolean;
  connectionId: string;
  connectionJid: string | null;
  reason?: string;
}

/**
 * Hook to check whether this group's WhatsApp account is a group admin
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
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Shared behaviour for every group action that has to be confirmed by WhatsApp.
 *
 * The cache is deliberately NOT patched with the requested change. WhatsApp can
 * refuse - admin rights revoked a moment ago, a number that declines group
 * invites, a permission the group owner locked - and a cache that already shows
 * the change would keep lying until the next refetch. Instead the queries are
 * refetched, and the realtime `group:updated` event refetches them again once
 * WhatsApp actually confirms.
 */
function useConfirmedGroupAction<TVariables extends { groupId: string }>(
  request: (variables: TVariables) => Promise<PendingGroupActionResponse>,
  fallbackError: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: groupKeys.detail(variables.groupId),
      });
      queryClient.invalidateQueries({ queryKey: groupKeys.lists() });
      toast.success(data.message);
    },
    onError: (error: Error) => {
      toast.error(error.message || fallbackError);
    },
  });
}

export interface GroupParticipantsVariables {
  groupId: string;
  participantJids: string[];
}

/** Add members to a group. */
export function useAddParticipants() {
  return useConfirmedGroupAction<GroupParticipantsVariables>(
    ({ groupId, participantJids }) =>
      api.post(`/groups/${groupId}/participants`, { participantJids }),
    "Failed to add members",
  );
}

/** Remove members from a group. */
export function useRemoveParticipants() {
  return useConfirmedGroupAction<GroupParticipantsVariables>(
    ({ groupId, participantJids }) =>
      api.post(`/groups/${groupId}/participants/remove`, { participantJids }),
    "Failed to remove members",
  );
}

/** Promote members to group admin. */
export function usePromoteParticipants() {
  return useConfirmedGroupAction<GroupParticipantsVariables>(
    ({ groupId, participantJids }) =>
      api.post(`/groups/${groupId}/participants/promote`, { participantJids }),
    "Failed to promote members",
  );
}

/** Demote group admins back to regular members. */
export function useDemoteParticipants() {
  return useConfirmedGroupAction<GroupParticipantsVariables>(
    ({ groupId, participantJids }) =>
      api.post(`/groups/${groupId}/participants/demote`, { participantJids }),
    "Failed to demote admins",
  );
}

export interface UpdateGroupSettingsVariables {
  groupId: string;
  name?: string;
  description?: string;
  isAnnounce?: boolean;
  isLocked?: boolean;
  isJoinApprovalRequired?: boolean;
  memberAddMode?: GroupMemberAddMode;
}

/** Update the group's WhatsApp name, description and permissions. */
export function useUpdateGroupSettings() {
  return useConfirmedGroupAction<UpdateGroupSettingsVariables>(
    ({ groupId, ...settings }) =>
      api.patch(`/groups/${groupId}/settings`, settings),
    "Failed to update group settings",
  );
}

/**
 * Leave a group.
 *
 * WhatsApp has no delete or disband action, so this only ends this account's
 * membership - the group carries on for its other members.
 */
export function useLeaveGroup() {
  return useConfirmedGroupAction<{ groupId: string }>(
    ({ groupId }) => api.post(`/groups/${groupId}/leave`),
    "Failed to leave the group",
  );
}

/** Fetch or rotate the group's invite link. */
export function useGroupInviteLink() {
  return useConfirmedGroupAction<{ groupId: string; reset: boolean }>(
    ({ groupId, reset }) =>
      api.post(`/groups/${groupId}/invite-link`, { reset }),
    "Failed to update the invite link",
  );
}

/** Re-read the group from WhatsApp without changing anything. */
export function useSyncGroup() {
  return useConfirmedGroupAction<{ groupId: string }>(
    ({ groupId }) => api.post(`/groups/${groupId}/sync`),
    "Failed to refresh the group",
  );
}

export interface GroupJoinRequest {
  jid: string;
  requestedAt: string | null;
}

interface GroupJoinRequestsResponse {
  requests: GroupJoinRequest[];
  /** Null until WhatsApp has been asked at least once. */
  syncedAt: string | null;
}

/**
 * Pending requests to join a group.
 *
 * WhatsApp exposes these only on demand, so this reads the last fetched set;
 * `useRefreshJoinRequests` asks WhatsApp for a newer one.
 */
export function useGroupJoinRequests(groupId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: joinRequestsKey(groupId || ""),
    queryFn: async () => {
      if (!groupId) throw new Error("No group ID provided");
      return api.get<GroupJoinRequestsResponse>(
        `/groups/${groupId}/join-requests`,
      );
    },
    enabled: Boolean(groupId) && enabled,
    staleTime: 30_000,
    gcTime: 300_000,
  });
}

/** Ask WhatsApp for an up-to-date list of pending join requests. */
export function useRefreshJoinRequests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId }: { groupId: string }) =>
      api.post<PendingGroupActionResponse>(
        `/groups/${groupId}/join-requests/refresh`,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: joinRequestsKey(variables.groupId),
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to refresh join requests");
    },
  });
}

/** Approve or reject pending requests to join a group. */
export function useDecideJoinRequests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      groupId,
      requesterJids,
      decision,
    }: {
      groupId: string;
      requesterJids: string[];
      decision: GroupJoinRequestAction;
    }) =>
      api.post<PendingGroupActionResponse>(
        `/groups/${groupId}/join-requests/decision`,
        { requesterJids, decision },
      ),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: joinRequestsKey(variables.groupId),
      });
      queryClient.invalidateQueries({
        queryKey: groupKeys.detail(variables.groupId),
      });
      toast.success(data.message);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update join requests");
    },
  });
}

export interface CreateGroupVariables {
  connectionId: string;
  name: string;
  participantJids: string[];
}

/**
 * Create a WhatsApp group.
 *
 * The group appears in the list only after WhatsApp confirms it, so nothing is
 * inserted into the cache here.
 */
export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: CreateGroupVariables) =>
      api.post<PendingGroupActionResponse>("/groups", variables),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: groupKeys.lists() });
      toast.success(data.message);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create the group");
    },
  });
}
