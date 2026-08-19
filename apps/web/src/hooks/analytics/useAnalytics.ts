import { useQuery } from "@tanstack/react-query";
import { dayjs } from "@wateaminbox/shared";
import { api } from "@/lib/api/client";
import {
  getCaseResolutionStats,
  getCaseResolutionTrend,
  getOverdueActiveCases,
  getTeamCaseResolutionStats,
} from "@/lib/api/resolution-analytics";
import type {
  CaseResolutionStats,
  CaseResolutionTrendPoint,
  OverdueCase,
  TeamCaseResolutionStats,
} from "@/lib/api/types";
import { queryKeys } from "../query-keys";

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
 * New contacts trend over time
 */
export interface NewContactsTrend {
  date: string;
  count: number;
  cumulativeTotal: number;
}

/**
 * Case-cycle resolution statistics (see @/lib/api/types for the full shape).
 */
export type {
  CaseResolutionStats,
  CaseResolutionTrendPoint,
  OverdueCase,
  TeamCaseResolutionStats,
};

/**
 * Customer engagement metrics
 */
export interface EngagementMetrics {
  engagementScore: number;
  averageMessagesPerContact: number;
  activeContactsRate: number;
  activeContacts: number;
  totalContacts: number;
  twoWayConversationRate: number;
  twoWayConversations: number;
  mediaEngagementRate: number;
  conversationsWithMedia: number;
  responseRate: number;
  messagesSent: number;
  messagesReceived: number;
}

/**
 * Engagement trend over time
 */
export interface EngagementTrend {
  date: string;
  engagementScore: number;
  activeContacts: number;
  messagesSent: number;
  messagesReceived: number;
  responseRate: number;
}

/**
 * Hook to fetch dashboard overview stats
 */
export function useDashboardStats(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.analytics.dashboard(companyId),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<DashboardStats>("/analytics/dashboard");
    },
    enabled: !!companyId,
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
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
    queryKey: queryKeys.analytics.messages(companyId, startDate, endDate),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/messages${queryString ? `?${queryString}` : ""}`;
      const response = await api.get<{
        stats: MessageStats[];
        meta: { startDate: string; endDate: string };
      }>(url);
      return response.stats;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/**
 * Hook to fetch contact statistics
 */
export function useContactStats(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.analytics.contacts(companyId),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<ContactStats>("/analytics/contacts");
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/**
 * Hook to fetch team activity statistics
 */
export function useTeamActivityStats(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.analytics.team(companyId),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<TeamActivityStats[]>("/analytics/team");
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
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
    queryKey: queryKeys.analytics.messageTypes(companyId, startDate, endDate),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/message-types${queryString ? `?${queryString}` : ""}`;
      return api.get<MessageTypeStats[]>(url);
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/**
 * Hook to fetch hourly message distribution
 */
export function useHourlyStats(companyId: string | null, days: number = 30) {
  return useQuery({
    queryKey: queryKeys.analytics.hourly(companyId, days),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<HourlyStats[]>(`/analytics/hourly?days=${days}`);
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/**
 * Hook to fetch new contacts trend over time
 */
export function useNewContactsTrend(
  companyId: string | null,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();

  return useQuery({
    queryKey: queryKeys.analytics.contactsTrend(companyId, startDate, endDate),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/contacts/trend${queryString ? `?${queryString}` : ""}`;
      const response = await api.get<{
        trend: NewContactsTrend[];
        meta: { startDate: string; endDate: string };
      }>(url);
      return response.trend;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
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
  return dayjs(dateStr).format("MMM D");
}

/**
 * Hook to fetch case-cycle resolution statistics (compliance, avg/median
 * business minutes, overdue active cases, direct/group breakdown).
 * `startDate`/`endDate` scope which RESOLVED cases count - overdue active
 * cases are always current, regardless of the range (see the API).
 */
export function useResolutionStats(
  companyId: string | null,
  startDate?: Date,
  endDate?: Date,
) {
  return useQuery({
    queryKey: queryKeys.analytics.resolution(
      companyId,
      startDate?.toISOString(),
      endDate?.toISOString(),
    ),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return getCaseResolutionStats(startDate, endDate);
    },
    enabled: !!companyId,
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch resolution trend over time (bucketed by resolved_at, in the
 * company's current SLA policy timezone).
 */
export function useResolutionTrend(
  companyId: string | null,
  startDate?: Date,
  endDate?: Date,
) {
  return useQuery({
    queryKey: queryKeys.analytics.resolutionTrend(
      companyId,
      startDate?.toISOString(),
      endDate?.toISOString(),
    ),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const response = await getCaseResolutionTrend(startDate, endDate);
      return response.trend;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/** Hook to fetch resolution attribution by team member. */
export function useResolutionTeamStats(
  companyId: string | null,
  startDate?: Date,
  endDate?: Date,
) {
  return useQuery({
    queryKey: queryKeys.analytics.resolutionTeam(
      companyId,
      startDate?.toISOString(),
      endDate?.toISOString(),
    ),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const response = await getTeamCaseResolutionStats(startDate, endDate);
      return response.stats;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/** Hook to fetch the currently-overdue active-case work queue. */
export function useOverdueActiveCases(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.analytics.resolutionOverdue(companyId),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return getOverdueActiveCases();
    },
    enabled: !!companyId,
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch customer engagement metrics
 */
export function useEngagementMetrics(
  companyId: string | null,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();

  return useQuery({
    queryKey: queryKeys.analytics.engagement(companyId, startDate, endDate),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/engagement${queryString ? `?${queryString}` : ""}`;
      return api.get<
        EngagementMetrics & {
          meta: { startDate: string; endDate: string };
        }
      >(url);
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/**
 * Hook to fetch engagement trend over time
 */
export function useEngagementTrend(
  companyId: string | null,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();

  return useQuery({
    queryKey: queryKeys.analytics.engagementTrend(
      companyId,
      startDate,
      endDate,
    ),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/analytics/engagement/trend${queryString ? `?${queryString}` : ""}`;
      const response = await api.get<{
        trend: EngagementTrend[];
        meta: { startDate: string; endDate: string };
      }>(url);
      return response.trend;
    },
    enabled: !!companyId,
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}
