import { describe, expect, test } from "bun:test";
import { decideContactAssignment } from "./assignment-policy.js";

const base = {
  actorUserId: "actor",
  targetUserId: "actor",
  targetIsCompanyMember: true,
  canAssignContacts: false,
};

describe("contact assignment policy", () => {
  test("allows an unassigned self-claim", () => {
    expect(decideContactAssignment(base)).toBe("allow");
  });

  test("allows authorized reassignment", () => {
    expect(
      decideContactAssignment({
        ...base,
        targetUserId: "target",
        currentAssigneeId: "previous",
        canAssignContacts: true,
      }),
    ).toBe("allow");
  });

  test("denies taking another assignee's contact", () => {
    expect(
      decideContactAssignment({ ...base, currentAssigneeId: "previous" }),
    ).toBe("permission_denied");
  });

  test("rejects invalid or cross-company targets", () => {
    expect(
      decideContactAssignment({ ...base, targetIsCompanyMember: false }),
    ).toBe("target_not_member");
    expect(
      decideContactAssignment({
        ...base,
        targetUserId: "cross-company-user",
        targetIsCompanyMember: false,
      }),
    ).toBe("target_not_member");
  });
});
