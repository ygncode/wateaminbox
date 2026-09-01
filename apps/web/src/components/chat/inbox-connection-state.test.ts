import { describe, expect, it } from "bun:test";
import { resolveInboxConnectionState } from "./inbox-connection-state";

describe("resolveInboxConnectionState", () => {
  it("shows first-run setup only after an empty connection list loads", () => {
    expect(
      resolveInboxConnectionState({
        connections: [],
        isLoading: false,
        isError: false,
      }),
    ).toBe("no-connections");
  });

  it("does not mistake loading or failed requests for first-run workspaces", () => {
    expect(
      resolveInboxConnectionState({
        connections: [],
        isLoading: true,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      resolveInboxConnectionState({
        connections: [],
        isLoading: false,
        isError: true,
      }),
    ).toBe("unavailable");
  });

  it("distinguishes connected accounts from linked accounts that are offline", () => {
    expect(
      resolveInboxConnectionState({
        connections: [{ status: "connected" }],
        isLoading: false,
        isError: false,
      }),
    ).toBe("connected");
    expect(
      resolveInboxConnectionState({
        connections: [{ status: "disconnected" }],
        isLoading: false,
        isError: false,
      }),
    ).toBe("offline");
  });
});
