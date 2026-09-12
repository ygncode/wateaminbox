import type { Chat } from "@/types/chat";

/**
 * A customer currently folded into this one, as the picker sees it.
 */
export interface MergedMember {
  contactId: string;
  mergeEventId: string;
  /** False once something has merged this contact again: not reversible. */
  reversible: boolean;
}

/**
 * The merges still in effect, as the picker's ticked rows.
 *
 * A merge event is history and outlives the merge itself: once reversed, the
 * row stays with `reversible: false`. Reading every event as a current member
 * listed people who had already been separated - ticked, undismissable, and
 * captioned with an explanation of why they could not be removed again.
 */
export function currentMembers(
  merges: ReadonlyArray<{
    sourceContactId: string;
    mergeEventId: string;
    reversible: boolean;
  }>,
): MergedMember[] {
  return merges
    .filter((entry) => entry.reversible)
    .map((entry) => ({
      contactId: entry.sourceContactId,
      mergeEventId: entry.mergeEventId,
      reversible: true,
    }));
}

export interface MergeSelectionPlan {
  /** Contacts to fold in, in the order the picker offered them. */
  toMerge: string[];
  /** Merges to reverse, named by the event that made them. */
  toUnmerge: Array<{ contactId: string; mergeEventId: string }>;
}

/**
 * What the operator's ticks mean, as operations.
 *
 * The picker shows one list of people with checkmarks, so a single Continue
 * can mean both "fold these two in" and "take that one back out". Working out
 * which is which from names or from the order rows were rendered would be
 * guesswork; it is done here, against the merge history, so the batch that
 * runs is exactly the difference between what was and what was asked for.
 *
 * A member that can no longer be reversed is never scheduled for an unmerge
 * even when unticked: the API would refuse it, and the picker disables its
 * checkbox for the same reason.
 */
export function planMergeSelection(input: {
  members: MergedMember[];
  selected: ReadonlySet<string>;
}): MergeSelectionPlan {
  const memberIds = new Set(input.members.map((member) => member.contactId));
  return {
    toMerge: [...input.selected].filter((id) => !memberIds.has(id)),
    toUnmerge: input.members
      .filter(
        (member) => member.reversible && !input.selected.has(member.contactId),
      )
      .map((member) => ({
        contactId: member.contactId,
        mergeEventId: member.mergeEventId,
      })),
  };
}

/** Whether this plan would change anything at all. */
export function isEmptyPlan(plan: MergeSelectionPlan): boolean {
  return plan.toMerge.length === 0 && plan.toUnmerge.length === 0;
}

/**
 * Whether an admin may be offered a merge with a contact of their choosing.
 *
 * Manual merge has no evidence behind it - it is entirely the operator's
 * judgement - so the gate is stricter than the suggestion list: the workspace
 * must actually be allowed to execute merges, rather than merely allowed to
 * look at candidates.
 */
export function shouldOfferManualMerge(input: {
  role: string | null | undefined;
  isGroup: boolean;
  mergeEnabled: boolean | undefined;
}): boolean {
  if (input.role !== "owner" && input.role !== "admin") return false;
  // A group is a thread, not a person. The API refuses a group merge outright.
  if (input.isGroup) return false;
  // Absent on an older API: treat the unknown as "not allowed" rather than
  // offering an action that would be refused.
  return input.mergeEnabled === true;
}

/**
 * Candidates an admin may pick from, once the obvious refusals are removed.
 *
 * The server refuses each of these too. Filtering here is about not offering
 * a choice that can only fail: a contact cannot merge into itself, a group is
 * never a person, and a contact already merged away is not a separate
 * customer to merge again. Contacts already folded into this customer are
 * dropped as well - the picker lists those itself, ticked, so offering them
 * again would show one person twice with two different meanings.
 */
export function selectableMergeCandidates(
  chats: Chat[],
  currentContactId: string,
  memberIds: ReadonlySet<string> = new Set(),
): Chat[] {
  return chats.filter(
    (chat) =>
      chat.contact.id !== currentContactId &&
      !chat.contact.isGroup &&
      !memberIds.has(chat.contact.id),
  );
}
