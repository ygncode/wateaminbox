/**
 * Group Route Helpers
 *
 * Shared helper functions for group routes.
 */
import type { Kysely } from "kysely";
import type { TenantDatabase } from "../../services/tenant.service.js";

/**
 * Check if current user is a group admin
 */
export async function isUserGroupAdmin(
  tenantDb: Kysely<TenantDatabase>,
  groupId: string,
  userJid: string | null,
): Promise<boolean> {
  if (!userJid) return false;

  // Get the group from contacts to get the actual group table entry
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", groupId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact) return false;

  // Get group ID from groups table
  const group = await tenantDb
    .selectFrom("groups")
    .select(["id"])
    .where("contact_id", "=", groupId)
    .executeTakeFirst();

  if (!group) return false;

  // Check if user is admin in this group
  const participant = await tenantDb
    .selectFrom("group_participants")
    .select(["is_admin"])
    .where("group_id", "=", group.id)
    .where("participant_jid", "=", userJid)
    .executeTakeFirst();

  return participant?.is_admin ?? false;
}

/**
 * Get the WhatsApp JID of the current connection
 */
export async function getConnectionJid(
  tenantDb: Kysely<TenantDatabase>,
): Promise<string | null> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  return connection?.jid ?? null;
}
