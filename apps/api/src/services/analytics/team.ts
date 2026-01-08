/**
 * Team analytics
 */

import { db } from "@whatsapp-web/database";
import { getTenantConnection } from "../tenant.service.js";
import type { TeamActivityStats } from "./types.js";

/**
 * Get team activity statistics
 */
export async function getTeamActivityStats(
  companyId: string,
): Promise<TeamActivityStats[]> {
  const tenantDb = getTenantConnection(companyId);

  // Get company members with their stats
  const members = await db
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
