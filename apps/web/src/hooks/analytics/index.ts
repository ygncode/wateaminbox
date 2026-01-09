/**
 * Analytics-related hooks
 *
 * Hooks for dashboard statistics, message analytics, contact trends,
 * resolution metrics, and engagement tracking.
 */

export {
  // Hooks
  useDashboardStats,
  useMessageStats,
  useContactStats,
  useTeamActivityStats,
  useMessageTypeStats,
  useHourlyStats,
  useNewContactsTrend,
  useResolutionStats,
  useResolutionTrend,
  useEngagementMetrics,
  useEngagementTrend,
  // Utilities
  formatNumber,
  formatDate,
  // Types
  type DashboardStats,
  type MessageStats,
  type ContactStats,
  type TeamActivityStats,
  type MessageTypeStats,
  type HourlyStats,
  type NewContactsTrend,
  type ResolutionStats,
  type ResolutionTrend,
  type EngagementMetrics,
  type EngagementTrend,
} from "./useAnalytics";
