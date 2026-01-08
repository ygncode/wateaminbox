/**
 * Dashboard analytics
 */

import { db } from "@whatsapp-web/database";
import { startOfDay, subtractDays, dayjs } from "@whatsapp-web/shared";
import { getTenantConnection } from "../tenant.service.js";
import type { DashboardStats } from "./types.js";

/**
 * Get dashboard overview statistics
 */
export async function getDashboardStats(
  companyId: string,
): Promise<DashboardStats> {
  const tenantDb = getTenantConnection(companyId);

  // Get basic stats from company_stats table
  const companyStats = await db
    .selectFrom("company_stats")
    .select(["total_messages", "total_contacts", "active_users"])
    .where("company_id", "=", companyId)
    .executeTakeFirst();

  const today = startOfDay().toDate();

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
    .where("timestamp", ">=", subtractDays(dayjs.utc(), 1).toDate())
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
