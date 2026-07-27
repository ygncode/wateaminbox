/**
 * Dashboard analytics
 */

import { db } from "@wateaminbox/database";
import { startOfDay } from "@wateaminbox/shared";
import { getTenantConnection } from "../tenant.service.js";
import type { DashboardStats } from "./types.js";

/**
 * Get dashboard overview statistics
 */
export async function getDashboardStats(
  companyId: string,
): Promise<DashboardStats> {
  const tenantDb = getTenantConnection(companyId);

  const today = startOfDay().toDate();

  const [messageStats, contactStats, memberStats, unreadStats] =
    await Promise.all([
      tenantDb
        .selectFrom("messages")
        .select((eb) => [
          eb.fn.countAll().as("total"),
          eb.fn
            .count("id")
            .filterWhere("from_me", "=", true)
            .filterWhere("timestamp", ">=", today)
            .as("sent_today"),
          eb.fn
            .count("id")
            .filterWhere("from_me", "=", false)
            .filterWhere("timestamp", ">=", today)
            .as("received_today"),
        ])
        .executeTakeFirst(),
      tenantDb
        .selectFrom("contacts")
        .select((eb) => eb.fn.countAll().as("total"))
        .where("is_group", "=", false)
        .executeTakeFirst(),
      db
        .selectFrom("company_members")
        .select((eb) => eb.fn.countAll().as("total"))
        .where("company_id", "=", companyId)
        .executeTakeFirst(),
      tenantDb
        .selectFrom("conversation_states")
        .select((eb) => eb.fn.countAll().as("total"))
        .where("unread_count", ">", 0)
        .executeTakeFirst(),
    ]);

  return {
    totalMessages: Number(messageStats?.total || 0),
    totalContacts: Number(contactStats?.total || 0),
    activeUsers: Number(memberStats?.total || 0),
    messagesSentToday: Number(messageStats?.sent_today || 0),
    messagesReceivedToday: Number(messageStats?.received_today || 0),
    unreadConversations: Number(unreadStats?.total || 0),
  };
}
