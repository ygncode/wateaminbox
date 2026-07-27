/**
 * Engagement analytics
 */

import { dayjs, toISOString } from "@wateaminbox/shared";
import { sql } from "kysely";
import { getSchemaName, getTenantConnection } from "../tenant.service.js";
import type { EngagementMetrics, EngagementTrend } from "./types.js";

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
  const messagesTable = sql.table(`${getSchemaName(companyId)}.messages`);
  const contactsTable = sql.table(`${getSchemaName(companyId)}.contacts`);

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
      FROM ${messagesTable} m
      INNER JOIN ${contactsTable} c ON c.id = m.contact_id
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
          SELECT 1 FROM ${messagesTable} outbound
          WHERE outbound.contact_id = m.contact_id
            AND outbound.from_me = true
            AND outbound.timestamp > m.timestamp
            AND outbound.timestamp < m.timestamp + INTERVAL '24 hours'
        ) as got_response
      FROM ${messagesTable} m
      INNER JOIN ${contactsTable} c ON c.id = m.contact_id
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
  const messagesTable = sql.table(`${getSchemaName(companyId)}.messages`);
  const contactsTable = sql.table(`${getSchemaName(companyId)}.contacts`);

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
      FROM ${messagesTable} m
      INNER JOIN ${contactsTable} c ON c.id = m.contact_id
      WHERE c.is_group = false
        AND m.timestamp >= ${startDate}
        AND m.timestamp <= ${endDate}
    ),
    daily_response AS (
      SELECT
        DATE(dm.timestamp) as message_date,
        dm.id,
        EXISTS (
          SELECT 1 FROM ${messagesTable} outbound
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
  let currentDate = dayjs.utc(startDate).startOf("day");
  const endDateNormalized = dayjs.utc(endDate).endOf("day");

  while (
    currentDate.isBefore(endDateNormalized) ||
    currentDate.isSame(endDateNormalized, "day")
  ) {
    const dateStr = currentDate.format("YYYY-MM-DD");
    const found = dailyStats.rows.find((d) => {
      const rowDate =
        d.date instanceof Date
          ? toISOString(d.date).split("T")[0]
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

    currentDate = currentDate.add(1, "day");
  }

  return result;
}
