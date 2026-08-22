/**
 * Pure composer-access decision logic, kept separate from MessageComposer/
 * ComposerLifecycleArea so it's directly unit-testable without rendering.
 *
 * Gates compose in this priority order (first match wins):
 *  1. Loading: lifecycle/assignment data isn't in yet - never flash a
 *     sendable (or any other) composer state before we actually know.
 *  2. Blocked: a blocked contact can't receive anything, so it outranks
 *     every remaining gate - taking over or reopening a blocked
 *     conversation would still leave every send rejected (the API's
 *     `requireSendAccess` throws ContactBlockedError). Unblocking is the
 *     only action that changes anything, so it's the only one offered.
 *     It also outranks the permission gate, because unblocking is NOT a
 *     send-permission-gated action: `PATCH /contacts/:id { isBlocked }`
 *     carries only auth + tenant + contact-visibility middleware (no
 *     `requirePermission`), which is exactly why the contact profile's
 *     Block Status section offers Block/Unblock without consulting
 *     `can`. Showing "you don't have permission to send" over a blocked
 *     contact would name the wrong reason AND hide an action the user is
 *     actually allowed to take; once they unblock, this falls through to
 *     the permission gate, which then states the real remaining reason.
 *  3. Permission: `can_send_messages` is a hard prerequisite for the
 *     remaining states - without it, Open/Reopen/Take over would all just
 *     403 server-side, so none of them are offered.
 *  4. Assignment: a contact actively assigned to someone else blocks
 *     typing/sending for everyone but that assignee, even with
 *     can_view_all_chats. Take over is offered only when the user has
 *     BOTH `can_send_messages` AND `can_assign_contacts` - the takeover
 *     call itself is a send-adjacent action gated the same way the
 *     backend gates it (POST /contacts/:id/assign requires
 *     can_assign_contacts; actually using the conversation afterward
 *     requires can_send_messages).
 *  5. Lifecycle: a resolved conversation (or one that's never been
 *     opened) replaces the composer with an Open/Reopen CTA. Pending does
 *     NOT gate the composer - it behaves like open.
 */

export type ComposerAccessState =
  | { kind: "loading" }
  | { kind: "no-permission" }
  | { kind: "sendable" }
  | { kind: "blocked" }
  | { kind: "resolved" }
  | { kind: "assigned-other-readonly"; assignedToName: string }
  | { kind: "assigned-other-takeover"; assignedToName: string };

export interface ComposerAccessInput {
  isLoading: boolean;
  /** Undefined/null means no conversation_states row at all - treated the same as "resolved" (never opened). */
  lifecycleStatus: "open" | "pending" | "resolved" | null | undefined;
  /** Whether the contact is blocked (contacts.is_blocked). */
  isBlocked: boolean;
  /** The contact's current assignee user id, or null if unassigned. */
  assignedTo: string | null;
  assignedToName: string | null;
  currentUserId: string;
  canSendMessages: boolean;
  /** Whether the current user could take over (POST /contacts/:id/assign to self). */
  canAssignContacts: boolean;
}

export function resolveComposerAccess(
  input: ComposerAccessInput,
): ComposerAccessState {
  if (input.isLoading) {
    return { kind: "loading" };
  }

  if (input.isBlocked) {
    return { kind: "blocked" };
  }

  if (!input.canSendMessages) {
    return { kind: "no-permission" };
  }

  const isAssignedToOther =
    input.assignedTo !== null && input.assignedTo !== input.currentUserId;

  if (isAssignedToOther) {
    const assignedToName = input.assignedToName ?? "another team member";
    return input.canAssignContacts
      ? { kind: "assigned-other-takeover", assignedToName }
      : { kind: "assigned-other-readonly", assignedToName };
  }

  if (input.lifecycleStatus === "open" || input.lifecycleStatus === "pending") {
    return { kind: "sendable" };
  }

  // "resolved", null, or undefined (no case history at all yet).
  return { kind: "resolved" };
}
