import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { shouldHoldInboxList } from "./chat-list-readiness";

describe("shouldHoldInboxList", () => {
  it("holds a partial list while another source is still loading", () => {
    // Telegram answered first; WhatsApp is still on its way.
    expect(
      shouldHoldInboxList({
        anySourceLoading: true,
        hasRows: true,
        graceElapsed: false,
      }),
    ).toBe(true);
  });

  it("shows the list once every source has settled", () => {
    expect(
      shouldHoldInboxList({
        anySourceLoading: false,
        hasRows: true,
        graceElapsed: false,
      }),
    ).toBe(false);
    // Settled and empty: the empty/first-run states take over, not the skeleton.
    expect(
      shouldHoldInboxList({
        anySourceLoading: false,
        hasRows: false,
        graceElapsed: false,
      }),
    ).toBe(false);
  });

  it("shows what arrived when a slow source outlasts the grace period", () => {
    expect(
      shouldHoldInboxList({
        anySourceLoading: true,
        hasRows: true,
        graceElapsed: true,
      }),
    ).toBe(false);
  });

  it("keeps the skeleton when nothing has arrived yet, even past the grace period", () => {
    expect(
      shouldHoldInboxList({
        anySourceLoading: true,
        hasRows: false,
        graceElapsed: true,
      }),
    ).toBe(true);
  });
});

describe("ChatList wiring", () => {
  const source = readFileSync(
    new URL("./ChatList.tsx", import.meta.url),
    "utf8",
  );

  it("renders rows only when the merged list is not being held", () => {
    expect(source).toContain("visibleChats.length > 0 && !holdList");
  });

  it("restarts the grace period for every new list scope", () => {
    expect(source).toMatch(/\}, \[isLoading, listScope\]\);/);
  });
});
