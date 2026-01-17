/**
 * Response time analytics
 */

import { sql } from "kysely";
import { db } from "@wateaminbox/database";
import { toISOString } from "@wateaminbox/shared";
import { getTenantConnection } from "../tenant.service.js";
import type {
  ResponseTimeStats,
  ResponseTimeByDate,
  TeamResponseTimeStats,
  SlaBreach,
} from "./types.js";

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
          ? toISOString(row.date).split("T")[0]
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
  const members = await db
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
 * Get conversations that exceeded SLA threshold
 */
export async function getSlaBreaches(
  companyId: string,
  startDate: Date,
  endDate: Date,
  slaThresholdMinutes: number = 60,
  limit: number = 50,
): Promise<SlaBreach[]> {
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
