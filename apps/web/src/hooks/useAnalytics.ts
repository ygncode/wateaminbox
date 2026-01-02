import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  totalMessages: number;
  totalContacts: number;
  activeUsers: number;
  messagesSentToday: number;
  messagesReceivedToday: number;
  unreadConversations: number;
}

/**
 * Message statistics over time
 */
export interface MessageStats {
  date: string;
  sent: number;
  received: number;
}

/**
 * Contact statistics
 */
export interface ContactStats {
  total: number;
  withCustomName: number;
  withTags: number;
  assigned: number;
  unassigned: number;
}

/**
 * Team activity statistics
 */
export interface TeamActivityStats {
  userId: string;
  email: string;
  messagesSent: number;
  contactsAssigned: number;
  lastActive: string | null;
}

/**
 * Message type distribution
 */
export interface MessageTypeStats {
  type: string;
  count: number;
}

/**
 * Hourly message distribution
 */
export interface HourlyStats {
  hour: number;
  count: number;
}

/**
 * Hook to fetch dashboard overview stats
 */
export function useDashboardStats(companyId: string | null) {
  return useQuery({
    queryKey: ["analytics", "dashboard", companyId],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const response = await api.get<{ data: DashboardStats }>(
        "/analytics/dashboard",
      );
      return response.data;
    },
    enabled: !!companyId,
    staleTime: 60_000, // 1 minute
    refetchInterval: 60_000, // Refresh every minute
  });
}

/**
 * Hook to fetch message statistics over time
 */
export function useMessageStats(
  companyId: string | null,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();

  return useQuery({
    queryKey: ["analytics", "messages", companyId, startDate, endDate],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/messages${queryString ? `?${queryString}` : ""}`;
      const response = await api.get<{
        data: MessageStats[];
        meta: { startDate: string; endDate: string };
      }>(url);
      return response;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch contact statistics
 */
export function useContactStats(companyId: string | null) {
  return useQuery({
    queryKey: ["analytics", "contacts", companyId],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const response = await api.get<{ data: ContactStats }>(
        "/analytics/contacts",
      );
      return response.data;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch team activity statistics
 */
export function useTeamActivityStats(companyId: string | null) {
  return useQuery({
    queryKey: ["analytics", "team", companyId],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const response = await api.get<{ data: TeamActivityStats[] }>(
        "/analytics/team",
      );
      return response.data;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch message type distribution
 */
export function useMessageTypeStats(
  companyId: string | null,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();

  return useQuery({
    queryKey: ["analytics", "message-types", companyId, startDate, endDate],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/message-types${queryString ? `?${queryString}` : ""}`;
      const response = await api.get<{ data: MessageTypeStats[] }>(url);
      return response.data;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch hourly message distribution
 */
export function useHourlyStats(companyId: string | null, days: number = 30) {
  return useQuery({
    queryKey: ["analytics", "hourly", companyId, days],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const response = await api.get<{ data: HourlyStats[] }>(
        `/analytics/hourly?days=${days}`,
      );
      return response.data;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
  });
}

/**
 * Format number for display
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Format date for display
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
