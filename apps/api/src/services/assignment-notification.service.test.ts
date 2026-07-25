import { describe, expect, test } from "bun:test";
import { getAssignmentNotificationInputs } from "./assignment-notification.service.js";

const base = {
  actorUserId: "actor",
  targetUserId: "target",
  contactId: "contact",
  contactName: "Ada",
};

describe("assignment notification recipients", () => {
  test("first assignment notifies a different new assignee", () => {
    const rows = getAssignmentNotificationInputs(base);
    expect(rows.map((row) => row.userId)).toEqual(["target"]);
    expect(rows[0]?.metadata?.event).toBe("assigned_to");
  });

  test("reassignment notifies new and previous assignees distinctly", () => {
    const rows = getAssignmentNotificationInputs({
      ...base,
      previousAssigneeId: "previous",
    });
    expect(rows.map((row) => row.userId)).toEqual(["target", "previous"]);
    expect(rows.map((row) => row.metadata?.event)).toEqual([
      "reassigned_to",
      "reassigned_from",
    ]);
  });

  test("self assignment suppresses the new-assignee notification", () => {
    expect(
      getAssignmentNotificationInputs({ ...base, targetUserId: "actor" }),
    ).toEqual([]);
  });

  test("a no-op assignment creates no notifications", () => {
    expect(
      getAssignmentNotificationInputs({
        ...base,
        previousAssigneeId: "target",
      }),
    ).toEqual([]);
  });
});
