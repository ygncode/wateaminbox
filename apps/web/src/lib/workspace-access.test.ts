import { describe, expect, test } from "bun:test";
import {
  isWorkspaceAccessBooting,
  resolveWorkspaceAccessRedirect,
} from "./workspace-access";

describe("workspace access loading", () => {
  test("blocks the route only until the current user's memberships load", () => {
    expect(
      isWorkspaceAccessBooting({
        isAuthenticated: true,
        userId: "user-1",
        loadedUserId: null,
      }),
    ).toBe(true);
    expect(
      isWorkspaceAccessBooting({
        isAuthenticated: true,
        userId: "user-1",
        loadedUserId: "user-1",
      }),
    ).toBe(false);
  });

  test("does not return to a blocking screen during background refreshes", () => {
    expect(
      isWorkspaceAccessBooting({
        isAuthenticated: true,
        userId: "user-1",
        loadedUserId: "user-1",
      }),
    ).toBe(false);
  });

  test("waits again when the authenticated identity changes", () => {
    expect(
      isWorkspaceAccessBooting({
        isAuthenticated: true,
        userId: "user-2",
        loadedUserId: "user-1",
      }),
    ).toBe(true);
  });
});

describe("workspace access routing", () => {
  test("keeps setup stable across refreshes", () => {
    expect(
      resolveWorkspaceAccessRedirect({
        mode: "setup",
        membershipCount: 0,
        activeWorkspaceId: null,
      }),
    ).toBeNull();
  });

  test("never leaves an empty chooser as a dead end", () => {
    expect(
      resolveWorkspaceAccessRedirect({
        mode: "chooser",
        membershipCount: 0,
        activeWorkspaceId: null,
      }),
    ).toBe("/company-setup");
  });

  test("uses the chooser only when a required route has no selection", () => {
    expect(
      resolveWorkspaceAccessRedirect({
        mode: "required",
        membershipCount: 2,
        activeWorkspaceId: null,
      }),
    ).toBe("/workspaces");
    expect(
      resolveWorkspaceAccessRedirect({
        mode: "required",
        membershipCount: 1,
        activeWorkspaceId: "northwind",
      }),
    ).toBeNull();
  });
});
