/**
 * Analytics types and interfaces
 */

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
  lastActive: Date | null;
}

/**
 * Response time statistics
 */
export interface ResponseTimeStatsCore {
  averageResponseTimeMinutes: number;
  medianResponseTimeMinutes: number;
  maxResponseTimeMinutes: number;
  minResponseTimeMinutes: number;
  totalConversations: number;
  withinSlaCount: number;
  slaComplianceRate: number;
  /** Unanswered episodes excluded via a valid response-SLA exclusion outcome (no_reply_needed/spam/duplicate) - never counted compliant. */
  excludedCount: number;
}

export interface ResponseTimeStats extends ResponseTimeStatsCore {
  byKind: {
    direct: ResponseTimeStatsCore;
    group: ResponseTimeStatsCore;
  };
}

/**
 * Response time by date
 */
export interface ResponseTimeByDate {
  date: string;
  averageResponseTimeMinutes: number;
  conversationCount: number;
  slaComplianceRate: number;
}

/**
 * Team response time stats
 */
export interface TeamResponseTimeStats {
  userId: string;
  email: string;
  averageResponseTimeMinutes: number;
  totalResponses: number;
  slaComplianceRate: number;
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
 * Customer engagement metrics
 */
export interface EngagementMetrics {
  // Overall engagement score (0-100)
  engagementScore: number;
  // Average messages per active contact
  averageMessagesPerContact: number;
  // Percentage of contacts with activity in the period
  activeContactsRate: number;
  // Number of active contacts
  activeContacts: number;
  // Total contacts
  totalContacts: number;
  // Percentage of contacts with two-way communication
  twoWayConversationRate: number;
  // Number of contacts with two-way communication
  twoWayConversations: number;
  // Percentage of conversations that include media
  mediaEngagementRate: number;
  // Number of conversations with media
  conversationsWithMedia: number;
  // Average response rate (% of inbound messages that got a reply)
  responseRate: number;
  // Messages sent in period
  messagesSent: number;
  // Messages received in period
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
 * SLA breach record
 */
export interface SlaBreach {
  contactId: string;
  contactName: string | null;
  inboundMessageTime: Date;
  responseTime: Date | null;
  responseMinutes: number;
  respondedBy: string | null;
}
