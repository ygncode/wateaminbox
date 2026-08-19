import { describe, expect, test } from "bun:test";
import { resolveComposerAccess } from "./composer-access";

const BASE = {
  isLoading: false,
  lifecycleStatus: "open" as const,
  assignedTo: null,
  assignedToName: null,
  currentUserId: "user-1",
  canSendMessages: true,
  canAssignContacts: false,
};

describe("resolveComposerAccess", () => {
  test("loading takes priority over everything else - never flashes a wrong state", () => {
    expect(resolveComposerAccess({ ...BASE, isLoading: true })).toEqual({
      kind: "loading",
    });
    expect(
      resolveComposerAccess({
        ...BASE,
        isLoading: true,
        lifecycleStatus: "resolved",
        assignedTo: "user-2",
      }),
    ).toEqual({ kind: "loading" });
  });

  test("no can_send_messages is read-only regardless of assignment/lifecycle", () => {
    expect(resolveComposerAccess({ ...BASE, canSendMessages: false })).toEqual({
      kind: "no-permission",
    });
    expect(
      resolveComposerAccess({
        ...BASE,
        canSendMessages: false,
        lifecycleStatus: "resolved",
      }),
    ).toEqual({ kind: "no-permission" });
    expect(
      resolveComposerAccess({
        ...BASE,
        canSendMessages: false,
        assignedTo: "user-2",
        canAssignContacts: true,
      }),
    ).toEqual({ kind: "no-permission" });
  });

  test("open + unassigned is sendable", () => {
    expect(resolveComposerAccess(BASE)).toEqual({ kind: "sendable" });
  });

  test("pending + unassigned is sendable (pending never gates the composer)", () => {
    expect(
      resolveComposerAccess({ ...BASE, lifecycleStatus: "pending" }),
    ).toEqual({ kind: "sendable" });
  });

  test("open + self-assigned is sendable", () => {
    expect(resolveComposerAccess({ ...BASE, assignedTo: "user-1" })).toEqual({
      kind: "sendable",
    });
  });

  test("resolved + unassigned shows the resolved CTA", () => {
    expect(
      resolveComposerAccess({ ...BASE, lifecycleStatus: "resolved" }),
    ).toEqual({ kind: "resolved" });
  });

  test("null lifecycle status (no case history at all) is treated as resolved", () => {
    expect(resolveComposerAccess({ ...BASE, lifecycleStatus: null })).toEqual({
      kind: "resolved",
    });
    expect(
      resolveComposerAccess({ ...BASE, lifecycleStatus: undefined }),
    ).toEqual({ kind: "resolved" });
  });

  test("assigned to another user without can_assign_contacts is read-only, even while open", () => {
    expect(
      resolveComposerAccess({
        ...BASE,
        assignedTo: "user-2",
        assignedToName: "Alex",
        canAssignContacts: false,
      }),
    ).toEqual({ kind: "assigned-other-readonly", assignedToName: "Alex" });
  });

  test("assigned to another user WITH can_assign_contacts (and can_send_messages) offers Take over, even while open", () => {
    expect(
      resolveComposerAccess({
        ...BASE,
        assignedTo: "user-2",
        assignedToName: "Alex",
        canAssignContacts: true,
      }),
    ).toEqual({ kind: "assigned-other-takeover", assignedToName: "Alex" });
  });

  test("can_assign_contacts alone, without can_send_messages, never offers Take over", () => {
    expect(
      resolveComposerAccess({
        ...BASE,
        canSendMessages: false,
        assignedTo: "user-2",
        assignedToName: "Alex",
        canAssignContacts: true,
      }),
    ).toEqual({ kind: "no-permission" });
  });

  test("assignment gate takes priority over the resolved gate - reachable (read-only or takeover) even when resolved", () => {
    expect(
      resolveComposerAccess({
        ...BASE,
        lifecycleStatus: "resolved",
        assignedTo: "user-2",
        assignedToName: "Alex",
        canAssignContacts: false,
      }),
    ).toEqual({ kind: "assigned-other-readonly", assignedToName: "Alex" });

    expect(
      resolveComposerAccess({
        ...BASE,
        lifecycleStatus: "resolved",
        assignedTo: "user-2",
        assignedToName: "Alex",
        canAssignContacts: true,
      }),
    ).toEqual({ kind: "assigned-other-takeover", assignedToName: "Alex" });
  });

  test("missing assignee display name falls back to a generic label", () => {
    expect(
      resolveComposerAccess({
        ...BASE,
        assignedTo: "user-2",
        assignedToName: null,
      }),
    ).toEqual({
      kind: "assigned-other-readonly",
      assignedToName: "another team member",
    });
  });
});
