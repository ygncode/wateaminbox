/**
 * Shared send-access guard for every outbound action that has an
 * identifiable acting user (compose send, attach, forward, retry,
 * schedule-create, typing, and - since scheduled dispatch re-validates
 * against `row.created_by` - non-bulk scheduled DISPATCH too; see the
 * module doc comment on `requireSendAccess` for the two invariants it
 * enforces).
 *
 * This is deliberately NOT enforced for the worker-relayed outbound path in
 * message-handlers.ts (a message that already went out via the device
 * cannot be retroactively rejected) or for bulk/broadcast scheduled
 * dispatch (no single "assignee" concept applies to a company-wide
 * broadcast; see scheduled-message.service.ts's own doc comment on what
 * bulk rows revalidate instead).
 */

import type { Transaction } from "kysely";
import { ContactAssignedToOtherError, NotFoundError } from "../lib/errors.js";
import { assignContactToUser, getCurrentAssignment } from "./contact.service.js";
import { requireActiveCaseForSend } from "./conversation-case.service.js";
import type { TenantDatabase } from "./tenant.service.js";

export { ContactAssignedToOtherError };

export interface SendAccessOptions {
  /**
   * When true (the default), an unassigned contact is atomically claimed
   * for `userId` under the same contact-row lock this function already
   * takes - mirrors the first-reply/first-send auto-assignment behavior,
   * but as PART of this transaction instead of a separate call beforehand
   * (see the module doc comment on why a separate call is unsafe). Pass
   * `false` for actions that must respect an existing assignment/read
   * lifecycle state without themselves claiming an unassigned contact
   * (e.g. starting a typing indicator).
   */
  claimUnassigned?: boolean;
}

/**
 * Enforces BOTH invariants an interactive outbound send must satisfy,
 * inside ONE transaction so neither can be raced against a concurrent
 * mutation:
 *
 *  - Assignment: a contact actively assigned to someone OTHER than
 *    `userId` blocks the send - even for a user with `can_view_all_chats`.
 *    An unassigned contact is atomically claimed for `userId` (unless
 *    `claimUnassigned: false`); a self-assigned contact is always fine.
 *  - Lifecycle: an active (open/pending) case must exist (delegates to
 *    `requireActiveCaseForSend`).
 *
 * Locks the contact row (`SELECT ... FOR UPDATE`) FIRST - the exact same
 * mechanism `POST /contacts/:id/assign`'s takeover uses - so a concurrent
 * takeover, a concurrent auto-claim, and a concurrent send are all fully
 * serialized against each other: whichever transaction starts first
 * observes (and the other waits for) a fully-settled assignment state
 * before proceeding. This closes the TOCTOU window between "check/claim
 * assignment" and "insert the message" - two simultaneous first-sends into
 * the same unassigned contact can never both succeed in claiming it (the
 * DB-level `UNIQUE(contact_id) WHERE unassigned_at IS NULL` index is the
 * final backstop even if application logic somehow raced anyway), a
 * takeover can never land invisibly in the middle of an in-flight send,
 * and a send can never slip through mid-takeover.
 *
 * IMPORTANT: callers must NOT call `ensureContactAssignment` (or any other
 * assignment claim) before starting the transaction this function runs
 * in - that would auto-claim OUTSIDE this lock and reopen exactly the race
 * this function exists to close.
 */
export async function requireSendAccess(
  trx: Transaction<TenantDatabase>,
  contactId: string,
  userId: string,
  options: SendAccessOptions = {},
): Promise<{ caseId: string; autoAssigned: boolean }> {
  const claimUnassigned = options.claimUnassigned ?? true;

  const contact = await trx
    .selectFrom("contacts")
    .select("id")
    .where("id", "=", contactId)
    .forUpdate()
    .executeTakeFirst();
  if (!contact) {
    throw new NotFoundError("Contact");
  }

  const assignment = await getCurrentAssignment(trx, contactId);
  let autoAssigned = false;
  if (assignment && assignment.assigned_to !== userId) {
    throw new ContactAssignedToOtherError(assignment.assigned_to);
  }
  if (!assignment && claimUnassigned) {
    await assignContactToUser(trx, contactId, userId, userId);
    autoAssigned = true;
  }

  const caseId = await requireActiveCaseForSend(trx, contactId);
  return { caseId, autoAssigned };
}
