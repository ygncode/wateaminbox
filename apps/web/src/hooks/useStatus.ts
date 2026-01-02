import { useQuery } from "@tanstack/react-query";
import { getAccessToken } from "../lib/api";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";

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

/**
 * Query keys for status-related queries
 */
export const statusKeys = {
  all: ["status"] as const,
  lists: () => [...statusKeys.all, "list"] as const,
  list: (filters?: { limit?: number; offset?: number }) =>
    [...statusKeys.lists(), filters] as const,
  contact: (jid: string) => [...statusKeys.all, "contact", jid] as const,
  stats: () => [...statusKeys.all, "stats"] as const,
};

/**
 * Hook to fetch all status updates
 */
export function useStatusUpdates(limit: number = 50, offset: number = 0) {
  return useQuery<ContactStatus[], Error>({
    queryKey: statusKeys.list({ limit, offset }),
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) {
        return [];
      }

      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const response = await fetch(`${API_BASE_URL}/status?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch status updates");
      }

      const result = await response.json();
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

      const token = getAccessToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${API_BASE_URL}/status/${encodeURIComponent(jid)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch contact status");
      }

      return response.json();
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
      const token = getAccessToken();
      if (!token) {
        return {
          activeStatuses: 0,
          contactsWithStatus: 0,
          totalStatusesReceived: 0,
        };
      }

      const response = await fetch(`${API_BASE_URL}/status/stats/overview`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch status stats");
      }

      return response.json();
    },
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5,
  });
}
