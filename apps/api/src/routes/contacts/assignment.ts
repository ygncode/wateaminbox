import { zValidator } from "@hono/zod-validator";
import { getContactDisplayName, toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { forbidden, notFound } from "../../lib/errors.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { created, successData, successMessage } from "../../lib/response.js";
import { assignContactSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";
import { requirePermission } from "../../middleware/tenant.js";
import { decideContactAssignment } from "../../services/assignment-policy.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { getCurrentAssignment } from "../../services/contact.service.js";
import { getAssignmentNotificationInputs } from "../../services/assignment-notification.service.js";
import { createAndPublishNotifications } from "../../services/notification-delivery.service.js";
import {
  getMemberWithPermissions,
  PERMISSIONS,
} from "../../services/permission.service.js";
import { getUserNames } from "../../services/user.service.js";

export const assignmentRoutes = new Hono();

/**
 * POST /contacts/:id/assign - Assign contact to a user (or self)
 * Body: { targetUserId?: string } - If not provided, assigns to current user
 *
 * When reassigning from another user (takeover):
 * - Creates notification for previous assignee
 * - Broadcasts realtime event for real-time update
 * - Logs to audit trail
 *
 * Permission: can_assign_contacts is required to assign to another user
 * Self-assignment (claiming unassigned contacts) is allowed for all members
 */
assignmentRoutes.post(
  "/:id/assign",
  zValidator("json", assignContactSchema),
  async (c) => {
    const { tenantDb, user, companyId, permissions } = getRouteContext(c);
    const contactId = c.req.param("id");
    const targetUserId = c.req.valid("json").targetUserId ?? user.id;

    // Assignment IDs reference public users, so tenant-schema isolation alone
    // cannot prevent a cross-company user ID from being stored.
    const targetMember = await getMemberWithPermissions(
      companyId,
      targetUserId,
    );
    if (!targetMember) {
      return notFound(c, "Company member");
    }

    if (
      decideContactAssignment({
        actorUserId: user.id,
        targetUserId,
        targetIsCompanyMember: true,
        canAssignContacts: permissions.can_assign_contacts,
      }) === "permission_denied"
    ) {
      return forbidden(
        c,
        "Permission denied: can_assign_contacts is required to assign contacts to other users",
      );
    }

    const result = await tenantDb.transaction().execute(async (trx) => {
      // Locking the contact serializes claims/reassignments for this contact.
      const contact = await trx
        .selectFrom("contacts")
        .select(["id", "custom_name", "push_name", "phone_number", "jid"])
        .where("id", "=", contactId)
        .forUpdate()
        .executeTakeFirst();
      if (!contact) return null;

      const previousAssignment = await getCurrentAssignment(trx, contactId);
      const previousAssigneeId = previousAssignment?.assigned_to;
      const isTakeover = Boolean(
        previousAssigneeId && previousAssigneeId !== targetUserId,
      );

      // A member may claim an unassigned contact, but may not take a contact
      // from another assignee (including by assigning it to themselves).
      if (
        decideContactAssignment({
          actorUserId: user.id,
          targetUserId,
          currentAssigneeId: previousAssigneeId,
          targetIsCompanyMember: true,
          canAssignContacts: permissions.can_assign_contacts,
        }) === "permission_denied"
      ) {
        return { forbiddenTakeover: true as const };
      }

      // Repeating an assignment to the same user is idempotent.
      if (previousAssignment?.assigned_to === targetUserId) {
        return {
          contact,
          assignment: previousAssignment!,
          previousAssigneeId,
          isTakeover: false,
          isNoop: true,
        };
      }

      await trx
        .updateTable("contact_assignments")
        .set({ unassigned_at: toDbDate() })
        .where("contact_id", "=", contactId)
        .where("unassigned_at", "is", null)
        .execute();

      const assignment = await trx
        .insertInto("contact_assignments")
        .values({
          contact_id: contactId,
          assigned_to: targetUserId,
          assigned_by: user.id,
        })
        .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
        .executeTakeFirstOrThrow();

      return {
        contact,
        assignment,
        previousAssigneeId,
        isTakeover,
        isNoop: false,
      };
    });

    if (!result) return notFound(c, "Contact");
    if ("forbiddenTakeover" in result) {
      return forbidden(
        c,
        "Permission denied: can_assign_contacts is required to reassign an assigned contact",
      );
    }

    const { contact, assignment, previousAssigneeId, isTakeover, isNoop } =
      result;
    const contactDisplayName = getContactDisplayName(
      contact,
      "Unknown Contact",
    );

    const notificationInputs = getAssignmentNotificationInputs({
      actorUserId: user.id,
      targetUserId,
      previousAssigneeId,
      contactId,
      contactName: contactDisplayName,
      isNoop,
    });
    // Persist the complete recipient batch before publishing targeted signals.
    await createAndPublishNotifications(companyId, notificationInputs);

    if (isTakeover && previousAssigneeId) {
      await broadcastToCompany(companyId, "contact:updated", {
        event: "reassigned",
        contactId,
        contactName: contactDisplayName,
        previousAssignee: previousAssigneeId,
        newAssignee: targetUserId,
        reassignedBy: user.id,
      });
    }

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.assigned",
      entityType: "contact",
      entityId: contactId,
      details: isTakeover
        ? {
            previousAssignee: previousAssigneeId,
            newAssignee: targetUserId,
            isTakeover: true,
            contactName: contactDisplayName,
          }
        : {
            assignee: targetUserId,
            isTakeover: false,
            contactName: contactDisplayName,
          },
      ipAddress: getClientIp(c.req.raw.headers),
    });

    return created(c, {
      assignment: {
        id: assignment.id,
        assignedTo: assignment.assigned_to,
        assignedBy: assignment.assigned_by,
        assignedAt: assignment.assigned_at,
      },
      wasTakeover: isTakeover,
      previousAssignee: previousAssigneeId ?? null,
    });
  },
);

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
assignmentRoutes.get(
  "/:id/assignments",
  requireContactVisibility(),
  async (c) => {
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

    return successData(
      c,
      assignments.map((assignment) => ({
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
      })),
    );
  },
);
