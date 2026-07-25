import type { CreateNotificationInput } from "./notification-history.service.js";

export function getAssignmentNotificationInputs(input: {
  actorUserId: string;
  targetUserId: string;
  previousAssigneeId?: string | null;
  contactId: string;
  contactName: string;
  isNoop?: boolean;
}): CreateNotificationInput[] {
  if (input.isNoop || input.previousAssigneeId === input.targetUserId)
    return [];

  const actionUrl = `/chat/${input.contactId}`;
  const notifications: CreateNotificationInput[] = [];
  const isReassignment = Boolean(input.previousAssigneeId);

  if (input.targetUserId !== input.actorUserId) {
    notifications.push({
      userId: input.targetUserId,
      notificationType: "assignment",
      title: isReassignment
        ? "Contact Reassigned to You"
        : "Contact Assigned to You",
      message: `You are now responsible for “${input.contactName}”`,
      actionUrl,
      metadata: {
        event: isReassignment ? "reassigned_to" : "assigned_to",
        contactId: input.contactId,
        contactName: input.contactName,
        assignedBy: input.actorUserId,
        previousAssignee: input.previousAssigneeId ?? null,
      },
    });
  }

  if (isReassignment && input.previousAssigneeId) {
    notifications.push({
      userId: input.previousAssigneeId,
      notificationType: "assignment",
      title: "Contact Reassigned",
      message: `“${input.contactName}” was reassigned to another team member`,
      actionUrl,
      metadata: {
        event: "reassigned_from",
        contactId: input.contactId,
        contactName: input.contactName,
        reassignedBy: input.actorUserId,
        newAssignee: input.targetUserId,
      },
    });
  }

  return notifications;
}
