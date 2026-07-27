/**
 * Message analytics
 */

import { dayjs, subtractDays } from "@wateaminbox/shared";
import { sql } from "kysely";
import { getTenantConnection } from "../tenant.service.js";
import type { MessageStats } from "./types.js";

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

  const startDate = subtractDays(dayjs.utc(), days).toDate();

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
