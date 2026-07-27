/**
 * Analytics service barrel export
 *
 * Provides all analytics functions organized by domain.
 */

// Contact analytics
export { getContactStats, getNewContactsTrend } from "./contacts.js";

// Dashboard analytics
export { getDashboardStats } from "./dashboard.js";
// Engagement analytics
export { getEngagementMetrics, getEngagementTrend } from "./engagement.js";
// Message analytics
export {
  getHourlyMessageStats,
  getMessageStats,
  getMessageTypeStats,
} from "./messages.js";
// Response time analytics
export {
  getResponseTimeStats,
  getResponseTimeTrend,
  getSlaBreaches,
  getTeamResponseTimeStats,
} from "./response-time.js";
// Team analytics
export { getTeamActivityStats } from "./team.js";
// Types
export type {
  ContactStats,
  DashboardStats,
  EngagementMetrics,
  EngagementTrend,
  MessageStats,
  NewContactsTrend,
  ResponseTimeByDate,
  ResponseTimeStats,
  SlaBreach,
  TeamActivityStats,
  TeamResponseTimeStats,
} from "./types.js";
