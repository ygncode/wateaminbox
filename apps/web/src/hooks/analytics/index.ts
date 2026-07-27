/**
 * Analytics-related hooks
 *
 * Hooks for dashboard statistics, message analytics, contact trends,
 * resolution metrics, and engagement tracking.
 */

export {
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
  type ResolutionStats,
  type ResolutionTrend,
  type TeamActivityStats,
  useContactStats,
  // Hooks
  useDashboardStats,
  useEngagementMetrics,
  useEngagementTrend,
  useHourlyStats,
  useMessageStats,
  useMessageTypeStats,
  useNewContactsTrend,
  useResolutionStats,
  useResolutionTrend,
  useTeamActivityStats,
} from "./useAnalytics";
