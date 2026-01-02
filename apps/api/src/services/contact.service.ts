import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

/**
 * Assigns a contact to a user
 */
export async function assignContactToUser(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string,
  assignedByUserId: string
): Promise<{
  id: string;
  assignedTo: string;
  assignedBy: string;
  assignedAt: Date;
}> {
  // Unassign previous assignment
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: new Date() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();

  // Create new assignment
  const assignment = await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: contactId,
      assigned_to: userId,
      assigned_by: assignedByUserId,
    })
    .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
    .executeTakeFirstOrThrow();

  return {
    id: assignment.id,
    assignedTo: assignment.assigned_to,
    assignedBy: assignment.assigned_by,
    assignedAt: assignment.assigned_at,
  };
}

/**
 * Gets the current assignment for a contact
 */
export async function getCurrentAssignment(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string
) {
  return await tenantDb
    .selectFrom("contact_assignments")
    .select(["id", "assigned_to", "assigned_by", "assigned_at"])
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .executeTakeFirst();
}

/**
 * Unassigns a contact
 */
export async function unassignContact(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string
): Promise<void> {
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: new Date() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();
}

/**
 * Ensures a contact is assigned to a user if not already assigned
 * This is used for "Assign to me on first reply"
 */
export async function ensureContactAssignment(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string
): Promise<boolean> {
  const currentAssignment = await getCurrentAssignment(tenantDb, contactId);

  if (!currentAssignment) {
    await assignContactToUser(tenantDb, contactId, userId, userId);
    return true;
  }

  return false;
}
