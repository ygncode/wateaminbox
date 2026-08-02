/**
 * Analytics-related hooks
 *
 * Hooks for dashboard statistics, message analytics, contact trends,
 * resolution metrics, and engagement tracking.
 */

export {
  type CaseResolutionStats,
  type CaseResolutionTrendPoint,
  type ContactStats,
  // Types
  type DashboardStats,
  type EngagementMetrics,
  type EngagementTrend,
  formatDate,
  // Utilities
  formatNumber,
  type HourlyStats,
  type MessageStats,
  type MessageTypeStats,
  type NewContactsTrend,
  type OverdueCase,
  type TeamActivityStats,
  type TeamCaseResolutionStats,
  useContactStats,
  // Hooks
  useDashboardStats,
  useEngagementMetrics,
  useEngagementTrend,
  useHourlyStats,
  useMessageStats,
  useMessageTypeStats,
  useNewContactsTrend,
  useOverdueActiveCases,
  useResolutionStats,
  useResolutionTeamStats,
  useResolutionTrend,
  useTeamActivityStats,
} from "./useAnalytics";
