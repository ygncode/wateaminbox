import { describe, expect, test } from "bun:test";
import type { Chat } from "@/types/chat";
import {
  selectableMergeCandidates,
  shouldOfferManualMerge,
} from "./ManualMergeSection";

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
    const candidates = selectableMergeCandidates(
      [chat("a"), chat("b")],
      "a",
    );
    expect(candidates.map((candidate) => candidate.contact.id)).toEqual(["b"]);
  });

  test("never offers a group", () => {
    const candidates = selectableMergeCandidates(
      [chat("b"), chat("g", true)],
      "a",
    );
    expect(candidates.map((candidate) => candidate.contact.id)).toEqual(["b"]);
  });
});
