import { sql } from "kysely";
import { getTenantConnection } from "./tenant.service.js";
import { db } from "@whatsapp-web/database";

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
 * Get dashboard overview statistics
 */
export async function getDashboardStats(
  companyId: string,
): Promise<DashboardStats> {
  const tenantDb = getTenantConnection(companyId);

  // Get basic stats from company_stats table
  const companyStats = await db
    .selectFrom("company_stats" as any)
    .select(["total_messages", "total_contacts", "active_users"])
    .where("company_id", "=", companyId)
    .executeTakeFirst();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get today's message counts
  const todayMessages = await tenantDb
    .selectFrom("messages")
    .select((eb) => [
      eb.fn.count("id").filterWhere("from_me", "=", true).as("sent"),
      eb.fn.count("id").filterWhere("from_me", "=", false).as("received"),
    ])
    .where("timestamp", ">=", today)
    .executeTakeFirst();

  // Get unread conversations count (simplified - contacts with recent unread messages)
  const unreadCount = await tenantDb
    .selectFrom("messages")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("from_me", "=", false)
    .where("timestamp", ">=", new Date(Date.now() - 24 * 60 * 60 * 1000))
    .executeTakeFirst();

  return {
    totalMessages: Number(companyStats?.total_messages || 0),
    totalContacts: Number(companyStats?.total_contacts || 0),
    activeUsers: Number(companyStats?.active_users || 0),
    messagesSentToday: Number(todayMessages?.sent || 0),
    messagesReceivedToday: Number(todayMessages?.received || 0),
    unreadConversations: Number(unreadCount?.count || 0),
  };
}

/**
 * Get message statistics over a date range
 */
export async function getMessageStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<MessageStats[]> {
  const tenantDb = getTenantConnection(companyId);

  const stats = await tenantDb
    .selectFrom("messages")
    .select((eb) => [
      sql<string>`DATE(timestamp)`.as("date"),
      eb.fn.count("id").filterWhere("from_me", "=", true).as("sent"),
      eb.fn.count("id").filterWhere("from_me", "=", false).as("received"),
    ])
    .where("timestamp", ">=", startDate)
    .where("timestamp", "<=", endDate)
    .groupBy(sql`DATE(timestamp)`)
    .orderBy("date", "asc")
    .execute();

  return stats.map((s) => ({
    date: String(s.date),
    sent: Number(s.sent),
    received: Number(s.received),
  }));
}

/**
 * Get contact statistics
 */
export async function getContactStats(
  companyId: string,
): Promise<ContactStats> {
  const tenantDb = getTenantConnection(companyId);

  // Total contacts
  const totalResult = await tenantDb
    .selectFrom("contacts")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("is_group", "=", false)
    .executeTakeFirst();

  // Contacts with custom names
  const customNameResult = await tenantDb
    .selectFrom("contacts")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("is_group", "=", false)
    .where("custom_name", "is not", null)
    .executeTakeFirst();

  // Contacts with tags
  const withTagsResult = await tenantDb
    .selectFrom("contacts")
    .innerJoin("contact_tags", "contact_tags.contact_id", "contacts.id")
    .select((eb) => eb.fn.count("contacts.id").distinct().as("count"))
    .where("contacts.is_group", "=", false)
    .executeTakeFirst();

  // Assigned contacts
  const assignedResult = await tenantDb
    .selectFrom("contact_assignments")
    .select((eb) => eb.fn.count("contact_id").distinct().as("count"))
    .where("unassigned_at", "is", null)
    .executeTakeFirst();

  const total = Number(totalResult?.count || 0);
  const assigned = Number(assignedResult?.count || 0);

  return {
    total,
    withCustomName: Number(customNameResult?.count || 0),
    withTags: Number(withTagsResult?.count || 0),
    assigned,
    unassigned: total - assigned,
  };
}

/**
 * Get team activity statistics
 */
export async function getTeamActivityStats(
  companyId: string,
): Promise<TeamActivityStats[]> {
  const tenantDb = getTenantConnection(companyId);

  // Get company members with their stats
  const members = await (db as any)
    .selectFrom("company_members as cm")
    .innerJoin("users as u", "u.id", "cm.user_id")
    .select(["cm.user_id", "u.email"])
    .where("cm.company_id", "=", companyId)
    .execute();

  const stats: TeamActivityStats[] = [];

  for (const member of members) {
    // Messages sent by user
    const messagesSent = await tenantDb
      .selectFrom("messages")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("sent_by_user_id", "=", member.user_id)
      .executeTakeFirst();

    // Contacts assigned to user
    const contactsAssigned = await tenantDb
      .selectFrom("contact_assignments")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("assigned_to", "=", member.user_id)
      .where("unassigned_at", "is", null)
      .executeTakeFirst();

    // Last message sent
    const lastMessage = await tenantDb
      .selectFrom("messages")
      .select(["timestamp"])
      .where("sent_by_user_id", "=", member.user_id)
      .orderBy("timestamp", "desc")
      .limit(1)
      .executeTakeFirst();

    stats.push({
      userId: member.user_id,
      email: member.email,
      messagesSent: Number(messagesSent?.count || 0),
      contactsAssigned: Number(contactsAssigned?.count || 0),
      lastActive: lastMessage?.timestamp || null,
    });
  }

  return stats.sort((a, b) => b.messagesSent - a.messagesSent);
}

/**
 * Get message type distribution
 */
export async function getMessageTypeStats(
  companyId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<{ type: string; count: number }[]> {
  const tenantDb = getTenantConnection(companyId);

  let query = tenantDb
    .selectFrom("messages")
    .select((eb) => ["message_type", eb.fn.countAll().as("count")])
    .groupBy("message_type")
    .orderBy("count", "desc");

  if (startDate) {
    query = query.where("timestamp", ">=", startDate);
  }
  if (endDate) {
    query = query.where("timestamp", "<=", endDate);
  }

  const results = await query.execute();

  return results.map((r) => ({
    type: r.message_type,
    count: Number(r.count),
  }));
}

/**
 * Get hourly message distribution
 */
export async function getHourlyMessageStats(
  companyId: string,
  days: number = 30,
): Promise<{ hour: number; count: number }[]> {
  const tenantDb = getTenantConnection(companyId);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const results = await tenantDb
    .selectFrom("messages")
    .select((eb) => [
      sql<number>`EXTRACT(HOUR FROM timestamp)`.as("hour"),
      eb.fn.countAll().as("count"),
    ])
    .where("timestamp", ">=", startDate)
    .groupBy(sql`EXTRACT(HOUR FROM timestamp)`)
    .orderBy("hour", "asc")
    .execute();

  // Fill in missing hours
  const hourlyStats: { hour: number; count: number }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const found = results.find((r) => Number(r.hour) === hour);
    hourlyStats.push({
      hour,
      count: found ? Number(found.count) : 0,
    });
  }

  return hourlyStats;
}

/**
 * Response time statistics
 */
export interface ResponseTimeStats {
  averageResponseTimeMinutes: number;
  medianResponseTimeMinutes: number;
  maxResponseTimeMinutes: number;
  minResponseTimeMinutes: number;
  totalConversations: number;
  withinSlaCount: number;
  slaComplianceRate: number;
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
 * Calculate response times for conversations
 * Response time is measured as time between last inbound message and first outbound response
 */
export async function getResponseTimeStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
  slaThresholdMinutes: number = 60,
): Promise<ResponseTimeStats> {
  const tenantDb = getTenantConnection(companyId);

  // Query to find response times: for each inbound message, find the next outbound message
  // from the same contact and calculate the time difference
  const result = await sql<{
    avg_response_minutes: number | null;
    median_response_minutes: number | null;
    max_response_minutes: number | null;
    min_response_minutes: number | null;
    total_count: string | null;
    within_sla_count: string | null;
  }>`
    WITH message_pairs AS (
      SELECT
        inbound.contact_id,
        inbound.timestamp as inbound_time,
        (
          SELECT MIN(outbound.timestamp)
          FROM messages outbound
          WHERE outbound.contact_id = inbound.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > inbound.timestamp
            AND outbound.timestamp < inbound.timestamp + INTERVAL '24 hours'
        ) as response_time
      FROM messages inbound
      WHERE inbound.from_me = false
        AND inbound.timestamp >= ${startDate}
        AND inbound.timestamp <= ${endDate}
    ),
    response_times AS (
      SELECT
        contact_id,
        EXTRACT(EPOCH FROM (response_time - inbound_time)) / 60 as response_minutes
      FROM message_pairs
      WHERE response_time IS NOT NULL
    )
    SELECT
      AVG(response_minutes) as avg_response_minutes,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_minutes) as median_response_minutes,
      MAX(response_minutes) as max_response_minutes,
      MIN(response_minutes) as min_response_minutes,
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE response_minutes <= ${slaThresholdMinutes}) as within_sla_count
    FROM response_times
  `.execute(tenantDb);

  const row = result.rows[0];
  const totalConversations = Number(row?.total_count || 0);
  const withinSlaCount = Number(row?.within_sla_count || 0);

  return {
    averageResponseTimeMinutes: Number(row?.avg_response_minutes || 0),
    medianResponseTimeMinutes: Number(row?.median_response_minutes || 0),
    maxResponseTimeMinutes: Number(row?.max_response_minutes || 0),
    minResponseTimeMinutes: Number(row?.min_response_minutes || 0),
    totalConversations,
    withinSlaCount,
    slaComplianceRate:
      totalConversations > 0 ? (withinSlaCount / totalConversations) * 100 : 0,
  };
}

/**
 * Get response time trends over time
 */
export async function getResponseTimeTrend(
  companyId: string,
  startDate: Date,
  endDate: Date,
  slaThresholdMinutes: number = 60,
): Promise<ResponseTimeByDate[]> {
  const tenantDb = getTenantConnection(companyId);

  const result = await sql<{
    date: Date;
    avg_response_minutes: number | null;
    total_count: string | null;
    within_sla_count: string | null;
  }>`
    WITH message_pairs AS (
      SELECT
        inbound.contact_id,
        DATE(inbound.timestamp) as message_date,
        inbound.timestamp as inbound_time,
        (
          SELECT MIN(outbound.timestamp)
          FROM messages outbound
          WHERE outbound.contact_id = inbound.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > inbound.timestamp
            AND outbound.timestamp < inbound.timestamp + INTERVAL '24 hours'
        ) as response_time
      FROM messages inbound
      WHERE inbound.from_me = false
        AND inbound.timestamp >= ${startDate}
        AND inbound.timestamp <= ${endDate}
    ),
    response_times AS (
      SELECT
        message_date,
        EXTRACT(EPOCH FROM (response_time - inbound_time)) / 60 as response_minutes
      FROM message_pairs
      WHERE response_time IS NOT NULL
    )
    SELECT
      message_date as date,
      AVG(response_minutes) as avg_response_minutes,
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE response_minutes <= ${slaThresholdMinutes}) as within_sla_count
    FROM response_times
    GROUP BY message_date
    ORDER BY message_date ASC
  `.execute(tenantDb);

  return result.rows.map((row) => {
    const totalCount = Number(row.total_count || 0);
    const withinSlaCount = Number(row.within_sla_count || 0);
    return {
      date:
        row.date instanceof Date
          ? row.date.toISOString().split("T")[0]
          : String(row.date),
      averageResponseTimeMinutes: Number(row.avg_response_minutes || 0),
      conversationCount: totalCount,
      slaComplianceRate:
        totalCount > 0 ? (withinSlaCount / totalCount) * 100 : 0,
    };
  });
}

/**
 * Get response time stats by team member
 */
export async function getTeamResponseTimeStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
  slaThresholdMinutes: number = 60,
): Promise<TeamResponseTimeStats[]> {
  const tenantDb = getTenantConnection(companyId);

  // Get company members
  const members = await (db as any)
    .selectFrom("company_members as cm")
    .innerJoin("users as u", "u.id", "cm.user_id")
    .select(["cm.user_id", "u.email"])
    .where("cm.company_id", "=", companyId)
    .execute();

  const stats: TeamResponseTimeStats[] = [];

  for (const member of members) {
    const result = await sql<{
      avg_response_minutes: number | null;
      total_count: string | null;
      within_sla_count: string | null;
    }>`
      WITH message_pairs AS (
        SELECT
          inbound.contact_id,
          inbound.timestamp as inbound_time,
          (
            SELECT MIN(outbound.timestamp)
            FROM messages outbound
            WHERE outbound.contact_id = inbound.contact_id
              AND outbound.from_me = true
              AND outbound.sent_by_user_id = ${member.user_id}
              AND outbound.timestamp > inbound.timestamp
              AND outbound.timestamp < inbound.timestamp + INTERVAL '24 hours'
          ) as response_time
        FROM messages inbound
        WHERE inbound.from_me = false
          AND inbound.timestamp >= ${startDate}
          AND inbound.timestamp <= ${endDate}
      ),
      response_times AS (
        SELECT
          EXTRACT(EPOCH FROM (response_time - inbound_time)) / 60 as response_minutes
        FROM message_pairs
        WHERE response_time IS NOT NULL
      )
      SELECT
        AVG(response_minutes) as avg_response_minutes,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE response_minutes <= ${slaThresholdMinutes}) as within_sla_count
      FROM response_times
    `.execute(tenantDb);

    const row = result.rows[0];
    const totalResponses = Number(row?.total_count || 0);
    const withinSlaCount = Number(row?.within_sla_count || 0);

    stats.push({
      userId: member.user_id,
      email: member.email,
      averageResponseTimeMinutes: Number(row?.avg_response_minutes || 0),
      totalResponses,
      slaComplianceRate:
        totalResponses > 0 ? (withinSlaCount / totalResponses) * 100 : 0,
    });
  }

  return stats.sort(
    (a, b) => a.averageResponseTimeMinutes - b.averageResponseTimeMinutes,
  );
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
 * Get new contacts trend over a date range
 * Shows daily new contact counts and cumulative total
 */
export async function getNewContactsTrend(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<NewContactsTrend[]> {
  const tenantDb = getTenantConnection(companyId);

  // Get daily new contact counts
  const dailyCounts = await tenantDb
    .selectFrom("contacts")
    .select((eb) => [
      sql<string>`DATE(created_at)`.as("date"),
      eb.fn.countAll().as("count"),
    ])
    .where("is_group", "=", false)
    .where("created_at", ">=", startDate)
    .where("created_at", "<=", endDate)
    .groupBy(sql`DATE(created_at)`)
    .orderBy("date", "asc")
    .execute();

  // Get total contacts before start date for cumulative calculation
  const previousTotal = await tenantDb
    .selectFrom("contacts")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("is_group", "=", false)
    .where("created_at", "<", startDate)
    .executeTakeFirst();

  const baseTotal = Number(previousTotal?.count || 0);

  // Fill in all days in the range and calculate cumulative totals
  const result: NewContactsTrend[] = [];
  let cumulativeTotal = baseTotal;
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  const endDateNormalized = new Date(endDate);
  endDateNormalized.setHours(23, 59, 59, 999);

  while (currentDate <= endDateNormalized) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const found = dailyCounts.find((d) => String(d.date) === dateStr);
    const count = found ? Number(found.count) : 0;
    cumulativeTotal += count;

    result.push({
      date: dateStr,
      count,
      cumulativeTotal,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return result;
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
 * Get customer engagement metrics
 * Calculates various engagement indicators based on message activity
 */
export async function getEngagementMetrics(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<EngagementMetrics> {
  const tenantDb = getTenantConnection(companyId);

  // Get total contacts (excluding groups)
  const totalContactsResult = await tenantDb
    .selectFrom("contacts")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("is_group", "=", false)
    .executeTakeFirst();

  const totalContacts = Number(totalContactsResult?.count || 0);

  // Get active contacts (contacts with messages in the period)
  const activeContactsResult = await tenantDb
    .selectFrom("messages")
    .innerJoin("contacts", "contacts.id", "messages.contact_id")
    .select((eb) => eb.fn.count("messages.contact_id").distinct().as("count"))
    .where("contacts.is_group", "=", false)
    .where("messages.timestamp", ">=", startDate)
    .where("messages.timestamp", "<=", endDate)
    .executeTakeFirst();

  const activeContacts = Number(activeContactsResult?.count || 0);

  // Get message counts
  const messageCountsResult = await tenantDb
    .selectFrom("messages")
    .innerJoin("contacts", "contacts.id", "messages.contact_id")
    .select((eb) => [
      eb.fn
        .count("messages.id")
        .filterWhere("messages.from_me", "=", true)
        .as("sent"),
      eb.fn
        .count("messages.id")
        .filterWhere("messages.from_me", "=", false)
        .as("received"),
    ])
    .where("contacts.is_group", "=", false)
    .where("messages.timestamp", ">=", startDate)
    .where("messages.timestamp", "<=", endDate)
    .executeTakeFirst();

  const messagesSent = Number(messageCountsResult?.sent || 0);
  const messagesReceived = Number(messageCountsResult?.received || 0);

  // Get two-way conversations (contacts with both sent and received messages)
  const twoWayResult = await sql<{ count: string }>`
    WITH contact_activity AS (
      SELECT
        m.contact_id,
        COUNT(*) FILTER (WHERE m.from_me = true) as sent_count,
        COUNT(*) FILTER (WHERE m.from_me = false) as received_count
      FROM messages m
      INNER JOIN contacts c ON c.id = m.contact_id
      WHERE c.is_group = false
        AND m.timestamp >= ${startDate}
        AND m.timestamp <= ${endDate}
      GROUP BY m.contact_id
    )
    SELECT COUNT(*) as count
    FROM contact_activity
    WHERE sent_count > 0 AND received_count > 0
  `.execute(tenantDb);

  const twoWayConversations = Number(twoWayResult.rows[0]?.count || 0);

  // Get conversations with media
  const mediaResult = await tenantDb
    .selectFrom("messages")
    .innerJoin("contacts", "contacts.id", "messages.contact_id")
    .select((eb) => eb.fn.count("messages.contact_id").distinct().as("count"))
    .where("contacts.is_group", "=", false)
    .where("messages.timestamp", ">=", startDate)
    .where("messages.timestamp", "<=", endDate)
    .where("messages.message_type", "in", [
      "image",
      "video",
      "audio",
      "document",
    ])
    .executeTakeFirst();

  const conversationsWithMedia = Number(mediaResult?.count || 0);

  // Calculate response rate (inbound messages that got a reply within 24 hours)
  const responseRateResult = await sql<{
    total_inbound: string;
    responded: string;
  }>`
    WITH inbound_messages AS (
      SELECT
        m.id,
        m.contact_id,
        m.timestamp as inbound_time,
        EXISTS (
          SELECT 1 FROM messages outbound
          WHERE outbound.contact_id = m.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > m.timestamp
            AND outbound.timestamp < m.timestamp + INTERVAL '24 hours'
        ) as got_response
      FROM messages m
      INNER JOIN contacts c ON c.id = m.contact_id
      WHERE m.from_me = false
        AND c.is_group = false
        AND m.timestamp >= ${startDate}
        AND m.timestamp <= ${endDate}
    )
    SELECT
      COUNT(*) as total_inbound,
      COUNT(*) FILTER (WHERE got_response = true) as responded
    FROM inbound_messages
  `.execute(tenantDb);

  const totalInbound = Number(responseRateResult.rows[0]?.total_inbound || 0);
  const respondedCount = Number(responseRateResult.rows[0]?.responded || 0);
  const responseRate =
    totalInbound > 0 ? (respondedCount / totalInbound) * 100 : 0;

  // Calculate rates
  const activeContactsRate =
    totalContacts > 0 ? (activeContacts / totalContacts) * 100 : 0;
  const twoWayConversationRate =
    activeContacts > 0 ? (twoWayConversations / activeContacts) * 100 : 0;
  const mediaEngagementRate =
    activeContacts > 0 ? (conversationsWithMedia / activeContacts) * 100 : 0;
  const averageMessagesPerContact =
    activeContacts > 0 ? (messagesSent + messagesReceived) / activeContacts : 0;

  // Calculate engagement score (weighted average of key metrics)
  // Weights: Active rate (25%), Two-way rate (25%), Response rate (30%), Media rate (20%)
  const engagementScore = Math.min(
    100,
    Math.round(
      activeContactsRate * 0.25 +
        twoWayConversationRate * 0.25 +
        responseRate * 0.3 +
        mediaEngagementRate * 0.2,
    ),
  );

  return {
    engagementScore,
    averageMessagesPerContact: Math.round(averageMessagesPerContact * 10) / 10,
    activeContactsRate: Math.round(activeContactsRate * 10) / 10,
    activeContacts,
    totalContacts,
    twoWayConversationRate: Math.round(twoWayConversationRate * 10) / 10,
    twoWayConversations,
    mediaEngagementRate: Math.round(mediaEngagementRate * 10) / 10,
    conversationsWithMedia,
    responseRate: Math.round(responseRate * 10) / 10,
    messagesSent,
    messagesReceived,
  };
}

/**
 * Get engagement trend over time
 * Shows daily engagement metrics
 */
export async function getEngagementTrend(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<EngagementTrend[]> {
  const tenantDb = getTenantConnection(companyId);

  // Get daily stats
  const dailyStats = await sql<{
    date: Date;
    active_contacts: string;
    sent: string;
    received: string;
    responded: string;
    total_inbound: string;
  }>`
    WITH daily_messages AS (
      SELECT
        DATE(m.timestamp) as message_date,
        m.contact_id,
        m.from_me,
        m.id,
        m.timestamp
      FROM messages m
      INNER JOIN contacts c ON c.id = m.contact_id
      WHERE c.is_group = false
        AND m.timestamp >= ${startDate}
        AND m.timestamp <= ${endDate}
    ),
    daily_response AS (
      SELECT
        DATE(dm.timestamp) as message_date,
        dm.id,
        EXISTS (
          SELECT 1 FROM messages outbound
          WHERE outbound.contact_id = dm.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > dm.timestamp
            AND outbound.timestamp < dm.timestamp + INTERVAL '24 hours'
        ) as got_response
      FROM daily_messages dm
      WHERE dm.from_me = false
    )
    SELECT
      dm.message_date as date,
      COUNT(DISTINCT dm.contact_id) as active_contacts,
      COUNT(*) FILTER (WHERE dm.from_me = true) as sent,
      COUNT(*) FILTER (WHERE dm.from_me = false) as received,
      (
        SELECT COUNT(*) FILTER (WHERE dr.got_response = true)
        FROM daily_response dr
        WHERE dr.message_date = dm.message_date
      ) as responded,
      (
        SELECT COUNT(*)
        FROM daily_response dr
        WHERE dr.message_date = dm.message_date
      ) as total_inbound
    FROM daily_messages dm
    GROUP BY dm.message_date
    ORDER BY dm.message_date ASC
  `.execute(tenantDb);

  // Get total contacts for engagement score calculation
  const totalContactsResult = await tenantDb
    .selectFrom("contacts")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("is_group", "=", false)
    .executeTakeFirst();

  const totalContacts = Number(totalContactsResult?.count || 0);

  // Fill in missing dates and calculate engagement scores
  const result: EngagementTrend[] = [];
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  const endDateNormalized = new Date(endDate);
  endDateNormalized.setHours(23, 59, 59, 999);

  while (currentDate <= endDateNormalized) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const found = dailyStats.rows.find((d) => {
      const rowDate =
        d.date instanceof Date
          ? d.date.toISOString().split("T")[0]
          : String(d.date);
      return rowDate === dateStr;
    });

    if (found) {
      const activeContacts = Number(found.active_contacts);
      const sent = Number(found.sent);
      const received = Number(found.received);
      const responded = Number(found.responded);
      const totalInbound = Number(found.total_inbound);

      const responseRate =
        totalInbound > 0 ? (responded / totalInbound) * 100 : 0;
      const activeRate =
        totalContacts > 0 ? (activeContacts / totalContacts) * 100 : 0;

      // Simplified daily engagement score
      const engagementScore = Math.min(
        100,
        Math.round(activeRate * 0.5 + responseRate * 0.5),
      );

      result.push({
        date: dateStr,
        engagementScore,
        activeContacts,
        messagesSent: sent,
        messagesReceived: received,
        responseRate: Math.round(responseRate * 10) / 10,
      });
    } else {
      result.push({
        date: dateStr,
        engagementScore: 0,
        activeContacts: 0,
        messagesSent: 0,
        messagesReceived: 0,
        responseRate: 0,
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return result;
}

/**
 * Get conversations that exceeded SLA threshold
 */
export async function getSlaBreaches(
  companyId: string,
  startDate: Date,
  endDate: Date,
  slaThresholdMinutes: number = 60,
  limit: number = 50,
): Promise<
  {
    contactId: string;
    contactName: string | null;
    inboundMessageTime: Date;
    responseTime: Date | null;
    responseMinutes: number;
    respondedBy: string | null;
  }[]
> {
  const tenantDb = getTenantConnection(companyId);

  const result = await sql<{
    contact_id: string;
    contact_name: string | null;
    inbound_time: Date;
    response_time: Date | null;
    response_minutes: number;
    responded_by: string | null;
  }>`
    WITH message_pairs AS (
      SELECT
        inbound.contact_id,
        COALESCE(c.custom_name, c.push_name, c.phone_number) as contact_name,
        inbound.timestamp as inbound_time,
        (
          SELECT MIN(outbound.timestamp)
          FROM messages outbound
          WHERE outbound.contact_id = inbound.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > inbound.timestamp
            AND outbound.timestamp < inbound.timestamp + INTERVAL '24 hours'
        ) as response_time,
        (
          SELECT outbound.sent_by_user_id
          FROM messages outbound
          WHERE outbound.contact_id = inbound.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > inbound.timestamp
            AND outbound.timestamp < inbound.timestamp + INTERVAL '24 hours'
          ORDER BY outbound.timestamp ASC
          LIMIT 1
        ) as responded_by
      FROM messages inbound
      INNER JOIN contacts c ON c.id = inbound.contact_id
      WHERE inbound.from_me = false
        AND inbound.timestamp >= ${startDate}
        AND inbound.timestamp <= ${endDate}
    )
    SELECT
      contact_id,
      contact_name,
      inbound_time,
      response_time,
      EXTRACT(EPOCH FROM (COALESCE(response_time, NOW()) - inbound_time)) / 60 as response_minutes,
      responded_by
    FROM message_pairs
    WHERE response_time IS NULL
      OR EXTRACT(EPOCH FROM (response_time - inbound_time)) / 60 > ${slaThresholdMinutes}
    ORDER BY response_minutes DESC
    LIMIT ${limit}
  `.execute(tenantDb);

  return result.rows.map((row) => ({
    contactId: row.contact_id,
    contactName: row.contact_name,
    inboundMessageTime: row.inbound_time,
    responseTime: row.response_time,
    responseMinutes: Number(row.response_minutes),
    respondedBy: row.responded_by,
  }));
}
