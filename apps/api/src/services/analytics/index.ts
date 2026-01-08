/**
 * Analytics service barrel export
 *
 * Provides all analytics functions organized by domain.
 */

// Types
export type {
  DashboardStats,
  MessageStats,
  ContactStats,
  TeamActivityStats,
  ResponseTimeStats,
  ResponseTimeByDate,
  TeamResponseTimeStats,
  NewContactsTrend,
  EngagementMetrics,
  EngagementTrend,
  SlaBreach,
} from "./types.js";

// Dashboard analytics
export { getDashboardStats } from "./dashboard.js";

// Message analytics
export {
  getMessageStats,
  getMessageTypeStats,
  getHourlyMessageStats,
} from "./messages.js";

// Contact analytics
export { getContactStats, getNewContactsTrend } from "./contacts.js";

// Team analytics
export { getTeamActivityStats } from "./team.js";

// Response time analytics
export {
  getResponseTimeStats,
  getResponseTimeTrend,
  getTeamResponseTimeStats,
  getSlaBreaches,
} from "./response-time.js";

// Engagement analytics
export { getEngagementMetrics, getEngagementTrend } from "./engagement.js";
