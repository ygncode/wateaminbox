import { describe, expect, test } from "bun:test";
import type { Chat } from "@/types/chat";
import {
  currentMembers,
  isEmptyPlan,
  planMergeSelection,
  selectableMergeCandidates,
  shouldOfferManualMerge,
} from "./merge-selection";

const base = {
  role: "owner" as string | null | undefined,
  isGroup: false,
  mergeEnabled: true as boolean | undefined,
};

/**
 * `Chat.id` is deliberately different from `Chat.contact.id` here: once a
 * thread has a conversation, the chat list addresses it by the conversation
 * id, and a merge that sent that id would name a customer that does not exist.
 */
const chat = (id: string, isGroup = false): Chat =>
  ({
    id: `conversation-of-${id}`,
    contact: { id, name: id, phoneNumber: "", isGroup },
  }) as unknown as Chat;

const member = (contactId: string, reversible = true) => ({
  contactId,
  mergeEventId: `event-${contactId}`,
  reversible,
});

describe("planMergeSelection", () => {
  test("reads a tick as a merge and an untick as an unmerge", () => {
    // One Continue can mean both at once, which is the whole reason this is
    // worked out from the history rather than from what the rows looked like.
    const plan = planMergeSelection({
      members: [member("a"), member("b")],
      selected: new Set(["a", "c"]),
    });
    expect(plan.toMerge).toEqual(["c"]);
    expect(plan.toUnmerge).toEqual([
      { contactId: "b", mergeEventId: "event-b" },
    ]);
  });

  test("leaves an unchanged selection alone", () => {
    const plan = planMergeSelection({
      members: [member("a")],
      selected: new Set(["a"]),
    });
    expect(isEmptyPlan(plan)).toBe(true);
  });

  test("never schedules an unmerge the API would refuse", () => {
    // Something merged this contact again since, so the event cannot be
    // reversed; unticking it has to be a no-op rather than a failing call.
    const plan = planMergeSelection({
      members: [member("a", false)],
      selected: new Set(),
    });
    expect(plan.toUnmerge).toEqual([]);
    expect(isEmptyPlan(plan)).toBe(true);
  });

  test("merges everything ticked on a customer with no merges yet", () => {
    const plan = planMergeSelection({
      members: [],
      selected: new Set(["a", "b"]),
    });
    expect(plan.toMerge).toEqual(["a", "b"]);
    expect(plan.toUnmerge).toEqual([]);
  });
});

describe("shouldOfferManualMerge", () => {
  test("offers a hand-picked merge to an owner or admin", () => {
    expect(shouldOfferManualMerge(base)).toBe(true);
    expect(shouldOfferManualMerge({ ...base, role: "admin" })).toBe(true);
  });

  test("hides it from a member, who the API would refuse anyway", () => {
    expect(shouldOfferManualMerge({ ...base, role: "member" })).toBe(false);
    expect(shouldOfferManualMerge({ ...base, role: null })).toBe(false);
  });

  test("never offers to merge a group, which is a thread and not a person", () => {
    expect(shouldOfferManualMerge({ ...base, isGroup: true })).toBe(false);
  });

  test("stays hidden unless the workspace may actually execute a merge", () => {
    // Unlike suggestions, which are readable before the gate opens, this
    // action can only end in the route's 409.
    expect(shouldOfferManualMerge({ ...base, mergeEnabled: false })).toBe(
      false,
    );
  });

  test("treats an older API's missing flag as not allowed", () => {
    expect(shouldOfferManualMerge({ ...base, mergeEnabled: undefined })).toBe(
      false,
    );
  });
});

describe("selectableMergeCandidates", () => {
  test("never offers the contact being merged into", () => {
    const candidates = selectableMergeCandidates([chat("a"), chat("b")], "a");
    expect(candidates.map((candidate) => candidate.contact.id)).toEqual(["b"]);
  });

  test("never offers a group", () => {
    const candidates = selectableMergeCandidates(
      [chat("b"), chat("g", true)],
      "a",
    );
    expect(candidates.map((candidate) => candidate.contact.id)).toEqual(["b"]);
  });

  test("never offers someone the picker already lists as merged in", () => {
    // They appear at the top, ticked. Offering them again would show one
    // person twice, with two different meanings for the same checkbox.
    const candidates = selectableMergeCandidates(
      [chat("b"), chat("c")],
      "a",
      new Set(["b"]),
    );
    expect(candidates.map((candidate) => candidate.contact.id)).toEqual(["c"]);
  });
});

describe("currentMembers", () => {
  test("counts only the merges still in effect", () => {
    // A reversed merge keeps its event as history. Reading it as membership
    // listed someone who had already been separated back out.
    expect(
      currentMembers([
        { sourceContactId: "a", mergeEventId: "e1", reversible: true },
        { sourceContactId: "b", mergeEventId: "e2", reversible: false },
      ]),
    ).toEqual([{ contactId: "a", mergeEventId: "e1", reversible: true }]);
  });

  test("has no members for a customer whose merges were all undone", () => {
    expect(
      currentMembers([
        { sourceContactId: "a", mergeEventId: "e1", reversible: false },
      ]),
    ).toEqual([]);
  });
});
