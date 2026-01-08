/**
 * Contact analytics
 */

import { sql } from "kysely";
import { dayjs } from "@whatsapp-web/shared";
import { getTenantConnection } from "../tenant.service.js";
import type { ContactStats, NewContactsTrend } from "./types.js";

/**
 * Get contact statistics
 */
export async function getContactStats(companyId: string): Promise<ContactStats> {
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
  let currentDate = dayjs.utc(startDate).startOf("day");
  const endDateNormalized = dayjs.utc(endDate).endOf("day");

  while (
    currentDate.isBefore(endDateNormalized) ||
    currentDate.isSame(endDateNormalized, "day")
  ) {
    const dateStr = currentDate.format("YYYY-MM-DD");
    const found = dailyCounts.find((d) => String(d.date) === dateStr);
    const count = found ? Number(found.count) : 0;
    cumulativeTotal += count;

    result.push({
      date: dateStr,
      count,
      cumulativeTotal,
    });

    currentDate = currentDate.add(1, "day");
  }

  return result;
}
