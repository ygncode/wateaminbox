import { Hono } from "hono";
import {
  toDbDate,
  toISOString,
  getContactDisplayName,
} from "@whatsapp-web/shared";
import { requirePermission } from "../../middleware/tenant.js";
import { getRouteContext } from "../../middleware/context.js";
import { PERMISSIONS } from "../../services/permission.service.js";
import { getCurrentAssignment } from "../../services/contact.service.js";
import { createNotification } from "../../services/notification-history.service.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { getUserNames } from "../../services/user.service.js";
import { broadcastToCompany } from "../ws/index.js";
import { notFound, forbidden } from "../../lib/errors.js";
import { successData, successMessage, created } from "../../lib/response.js";

export const assignmentRoutes = new Hono();

/**
 * POST /contacts/:id/assign - Assign contact to a user (or self)
 * Body: { targetUserId?: string } - If not provided, assigns to current user
 *
 * When reassigning from another user (takeover):
 * - Creates notification for previous assignee
 * - Broadcasts WebSocket event for real-time update
 * - Logs to audit trail
 *
 * Permission: can_assign_contacts is required to assign to another user
 * Self-assignment (claiming unassigned contacts) is allowed for all members
 */
assignmentRoutes.post("/:id/assign", async (c) => {
  const { tenantDb, user, companyId, permissions } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Parse optional body for targetUserId
  let targetUserId = user.id;
  try {
    const body = await c.req.json();
    if (body.targetUserId) {
      targetUserId = body.targetUserId;
    }
  } catch {
    // No body or invalid JSON - default to self-assignment
  }

  // Check permission: can_assign_contacts required to assign to someone else
  if (targetUserId !== user.id && !permissions?.can_assign_contacts) {
    return forbidden(
      c,
      "Permission denied: can_assign_contacts is required to assign contacts to other users",
    );
  }

  // Check if contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "custom_name", "push_name", "phone_number", "jid"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  // Get contact display name
  const contactDisplayName = getContactDisplayName(contact, "Unknown Contact");

  // Get current assignment before updating
  const previousAssignment = await getCurrentAssignment(tenantDb, contactId);
  const previousAssigneeId = previousAssignment?.assigned_to;
  const isTakeover = previousAssigneeId && previousAssigneeId !== targetUserId;

  // Unassign previous assignment
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: toDbDate() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();

  // Create new assignment
  const assignment = await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: contactId,
      assigned_to: targetUserId,
      assigned_by: user.id,
    })
    .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
    .executeTakeFirst();

  // If this is a takeover (reassigning from another user), create notification
  if (isTakeover && previousAssigneeId) {
    // Create in-app notification for previous assignee
    await createNotification(companyId, {
      userId: previousAssigneeId,
      notificationType: "assignment",
      title: "Contact Reassigned",
      message: `"${contactDisplayName}" has been reassigned to another team member`,
      actionUrl: `/chat/${contactId}`,
      metadata: {
        contactId,
        contactName: contactDisplayName,
        reassignedBy: user.id,
        newAssignee: targetUserId,
      },
    });

    // Broadcast WebSocket event for real-time update
    broadcastToCompany(companyId, {
      type: "contact",
      payload: {
        event: "reassigned",
        contactId,
        contactName: contactDisplayName,
        previousAssignee: previousAssigneeId,
        newAssignee: targetUserId,
        reassignedBy: user.id,
      },
      timestamp: toISOString(),
    });

    // Create audit log
    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.assigned",
      entityType: "contact",
      entityId: contactId,
      details: {
        previousAssignee: previousAssigneeId,
        newAssignee: targetUserId,
        isTakeover: true,
        contactName: contactDisplayName,
      },
      ipAddress: getClientIp(c.req.raw.headers),
    });
  } else {
    // Regular assignment (not a takeover)
    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.assigned",
      entityType: "contact",
      entityId: contactId,
      details: {
        assignee: targetUserId,
        isTakeover: false,
        contactName: contactDisplayName,
      },
      ipAddress: getClientIp(c.req.raw.headers),
    });
  }

  return created(c, {
    assignment: {
      id: assignment?.id,
      assignedTo: assignment?.assigned_to,
      assignedBy: assignment?.assigned_by,
      assignedAt: assignment?.assigned_at,
    },
    wasTakeover: !!isTakeover,
    previousAssignee: previousAssigneeId || null,
  });
});

/**
 * DELETE /contacts/:id/assign - Unassign contact
 * Requires can_assign_contacts permission
 */
assignmentRoutes.delete(
  "/:id/assign",
  requirePermission(PERMISSIONS.CAN_ASSIGN_CONTACTS),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const contactId = c.req.param("id");

    await tenantDb
      .updateTable("contact_assignments")
      .set({ unassigned_at: toDbDate() })
      .where("contact_id", "=", contactId)
      .where("unassigned_at", "is", null)
      .execute();

    return successMessage(c, "Contact unassigned");
  },
);

/**
 * GET /contacts/:id/assignments - Get assignment history for a contact
 */
assignmentRoutes.get("/:id/assignments", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Check if contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  // Get all assignments (including historical ones)
  const assignments = await tenantDb
    .selectFrom("contact_assignments")
    .select([
      "id",
      "assigned_to",
      "assigned_by",
      "assigned_at",
      "unassigned_at",
    ])
    .where("contact_id", "=", contactId)
    .orderBy("assigned_at", "desc")
    .execute();

  // Collect all user IDs and fetch their names
  const userIds = assignments.flatMap((a) => [a.assigned_to, a.assigned_by]);
  const userNames = await getUserNames(userIds);

  return successData(c, assignments.map((assignment) => ({
    id: assignment.id,
    assignedTo: assignment.assigned_to,
    assignedToName:
      userNames.get(assignment.assigned_to) || assignment.assigned_to,
    assignedBy: assignment.assigned_by,
    assignedByName:
      userNames.get(assignment.assigned_by) || assignment.assigned_by,
    assignedAt: assignment.assigned_at,
    unassignedAt: assignment.unassigned_at,
    isActive: assignment.unassigned_at === null,
  })));
});
