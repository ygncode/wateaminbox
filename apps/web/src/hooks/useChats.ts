import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toDate } from "@whatsapp-web/shared";
import { getAccessToken, getCompanyId } from "../lib/api";
import { fetchMockChats, searchMockChats } from "../lib/mock-data";
import type { Chat } from "../types/chat";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3001/api";

/**
 * Assignment filter type
 */
export type AssignmentFilter = "all" | "assignedToMe" | "unassigned" | "unread";

/**
 * Query key factory for chat-related queries
 */
export const chatKeys = {
  all: ["chats"] as const,
  lists: () => [...chatKeys.all, "list"] as const,
  list: (filters: {
    search?: string;
    includeGroups?: boolean;
    assignmentFilter?: AssignmentFilter;
  }) => [...chatKeys.lists(), filters] as const,
  details: () => [...chatKeys.all, "detail"] as const,
  detail: (id: string) => [...chatKeys.details(), id] as const,
  groups: () => [...chatKeys.all, "groups"] as const,
  groupList: (filters: { search?: string }) =>
    [...chatKeys.groups(), filters] as const,
};

interface ContactApiResponse {
  id: string;
  jid: string;
  phoneNumber: string;
  pushName: string;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  profilePictureUrl: string | null;
  notesShared: string | null;
  lastMessageAt: string | null;
  lastMessage: {
    id: string;
    messageId: string;
    fromMe: boolean;
    messageType: string;
    content: string;
    status: string;
    timestamp: string;
  } | null;
  unreadCount: number;
  assignedTo: string | null;
  isOnline: boolean;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContactsListResponse {
  data: ContactApiResponse[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Hook to fetch and manage chat list data
 * Supports search filtering, group inclusion, and assignment filtering
 */
export function useChats(
  searchQuery: string = "",
  includeGroups: boolean = true,
  assignmentFilter: AssignmentFilter = "all",
) {
  // Memoize the query key to prevent unnecessary re-renders
  const queryKey = useMemo(
    () =>
      chatKeys.list({
        search: searchQuery,
        includeGroups,
        assignmentFilter,
      }),
    [searchQuery, includeGroups, assignmentFilter],
  );

  return useQuery<Chat[], Error>({
    queryKey,
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) {
        // Fall back to mock data if not authenticated
        if (searchQuery.trim()) {
          return searchMockChats(searchQuery);
        }
        return fetchMockChats();
      }

      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("search", searchQuery);
      }
      if (includeGroups) {
        params.set("includeGroups", "true");
      }
      if (assignmentFilter === "assignedToMe") {
        params.set("assignedToMe", "true");
      } else if (assignmentFilter === "unassigned") {
        params.set("unassigned", "true");
      }
      params.set("limit", "100");

      const companyId = getCompanyId();
      if (!companyId) {
        // No company selected, fall back to mock data
        if (searchQuery.trim()) {
          return searchMockChats(searchQuery);
        }
        return fetchMockChats();
      }

      const response = await fetch(`${API_BASE_URL}/contacts?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Company-ID": companyId,
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch contacts");
      }

      const result: ContactsListResponse = await response.json();

      // Transform API response to Chat format
      let chats = result.data.map(
        (contact): Chat => ({
          id: contact.id,
          contact: {
            id: contact.id,
            jid: contact.jid,
            phoneNumber: contact.phoneNumber || "",
            name: contact.displayName,
            customName: contact.customName || undefined,
            avatarUrl: contact.profilePictureUrl || undefined,
            isOnline: contact.isOnline,
            lastSeen: contact.lastSeen
              ? (toDate(contact.lastSeen) ?? undefined)
              : undefined,
            isGroup: contact.isGroup,
          },
          lastMessage: contact.lastMessage
            ? {
                id: contact.lastMessage.id,
                chatId: contact.id,
                senderId: contact.lastMessage.fromMe ? "me" : contact.id,
                content: contact.lastMessage.content || "",
                type: contact.lastMessage.messageType as any,
                status: contact.lastMessage.status as any,
                timestamp: toDate(contact.lastMessage.timestamp) ?? new Date(),
                isFromMe: contact.lastMessage.fromMe,
              }
            : undefined,
          unreadCount: contact.unreadCount,
          assignedTo: contact.assignedTo || undefined,
          isPinned: false,
          isMuted: false,
          isArchived: false,
          updatedAt: toDate(contact.updatedAt) ?? new Date(),
        }),
      );

      // Filter by unread if needed (client-side filter)
      if (assignmentFilter === "unread") {
        chats = chats.filter((chat) => chat.unreadCount > 0);
      }

      return chats;
    },
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch groups only (returns data as Chat format for chat list compatibility)
 * @deprecated Use useGroups from useGroups.ts for the proper GroupListItem format
 */
export function useGroupsAsChats(searchQuery: string = "") {
  return useQuery<Chat[], Error>({
    queryKey: chatKeys.groupList({ search: searchQuery }),
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) {
        return [];
      }

      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("search", searchQuery);
      }
      params.set("limit", "100");

      const companyId = getCompanyId();
      if (!companyId) {
        return [];
      }

      const response = await fetch(`${API_BASE_URL}/groups?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Company-ID": companyId,
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch groups");
      }

      const result = await response.json();

      // Transform API response to Chat format
      return result.data.map(
        (group: {
          id: string;
          jid: string;
          name: string;
          displayName: string;
          description?: string;
          participantCount?: number;
          profilePictureUrl?: string | null;
          lastMessageAt?: string | null;
          unreadCount: number;
          createdAt: string;
        }): Chat => ({
          id: group.id,
          contact: {
            id: group.id,
            phoneNumber: "",
            name: group.displayName,
            customName:
              group.name !== group.displayName ? group.name : undefined,
            avatarUrl: group.profilePictureUrl || undefined,
            isOnline: false,
            isGroup: true,
            about: group.description,
          },
          lastMessage: group.lastMessageAt
            ? {
                id: "",
                chatId: group.id,
                senderId: "",
                content: "",
                type: "text",
                status: "delivered",
                timestamp: toDate(group.lastMessageAt) ?? new Date(),
                isFromMe: false,
              }
            : undefined,
          unreadCount: group.unreadCount,
          isPinned: false,
          isMuted: false,
          isArchived: false,
          updatedAt: toDate(group.createdAt) ?? new Date(),
        }),
      );
    },
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to fetch a single chat by ID
 */
export function useChat(chatId: string) {
  return useQuery<Chat | undefined, Error>({
    queryKey: chatKeys.detail(chatId),
    queryFn: async () => {
      const chats = await fetchMockChats();
      return chats.find((chat) => chat.id === chatId);
    },
    enabled: !!chatId,
    staleTime: 1000 * 60 * 5,
  });
}
