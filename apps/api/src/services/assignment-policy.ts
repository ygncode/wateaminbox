export type AssignmentDecision =
  | "allow"
  | "target_not_member"
  | "permission_denied";

export function decideContactAssignment(input: {
  actorUserId: string;
  targetUserId: string;
  currentAssigneeId?: string | null;
  targetIsCompanyMember: boolean;
  canAssignContacts: boolean;
}): AssignmentDecision {
  if (!input.targetIsCompanyMember) return "target_not_member";
  const assigningAnotherUser = input.targetUserId !== input.actorUserId;
  const takingAssignedContact = Boolean(
    input.currentAssigneeId && input.currentAssigneeId !== input.targetUserId,
  );
  if (
    !input.canAssignContacts &&
    (assigningAnotherUser || takingAssignedContact)
  ) {
    return "permission_denied";
  }
  return "allow";
}
