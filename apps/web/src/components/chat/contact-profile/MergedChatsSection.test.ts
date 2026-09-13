import { describe, expect, test } from "bun:test";
import { shouldShowMergedChats } from "./MergedChatsSection";

/**
 * The section is the only home the merge tools have left, so its gate decides
 * whether an admin can reach "Merge another contact in" at all.
 */
describe("shouldShowMergedChats", () => {
  test("shows a merged customer's threads to anyone who can see them", () => {
    expect(shouldShowMergedChats({ chatCount: 2, canManage: false })).toBe(
      true,
    );
  });

  test("keeps a single-thread customer's section for the merge tools", () => {
    // One thread is not worth listing on its own, but hiding the section
    // entirely would leave manual merge unreachable for an admin.
    expect(shouldShowMergedChats({ chatCount: 1, canManage: true })).toBe(true);
  });

  test("shows nothing to a member on an unmerged customer", () => {
    expect(shouldShowMergedChats({ chatCount: 1, canManage: false })).toBe(
      false,
    );
    expect(shouldShowMergedChats({ chatCount: 0, canManage: false })).toBe(
      false,
    );
  });
});
