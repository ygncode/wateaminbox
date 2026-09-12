import { describe, expect, test } from "bun:test";
import type { RetiredRefreshToken } from "@wateaminbox/database";
import {
  isRetiredRefreshTokenAccepted,
  MAX_RETAINED_REFRESH_TOKENS,
  pruneRetiredRefreshTokens,
  readRetiredRefreshTokens,
  retainSupersededRefreshToken,
} from "./refresh-token-retention.js";

const NOW = Date.parse("2026-09-12T00:00:00.000Z");
const GRACE_MS = 60_000;

function entry(hash: string, offsetMs: number): RetiredRefreshToken {
  return { hash, expiresAt: new Date(NOW + offsetMs).toISOString() };
}

describe("readRetiredRefreshTokens", () => {
  test("returns an empty list for a session that never rotated", () => {
    expect(readRetiredRefreshTokens([])).toEqual([]);
    expect(readRetiredRefreshTokens(null)).toEqual([]);
    expect(readRetiredRefreshTokens(undefined)).toEqual([]);
  });

  test("reads back the shape the writer produces", () => {
    const stored = [entry("a".repeat(64), GRACE_MS)];

    expect(
      readRetiredRefreshTokens(JSON.parse(JSON.stringify(stored))),
    ).toEqual(stored);
  });

  test("drops malformed entries instead of throwing", () => {
    // The column can outlive the shape written by this release, and a bad row
    // must cost one re-login rather than break every refresh for the session.
    const parsed = readRetiredRefreshTokens([
      { hash: "kept", expiresAt: new Date(NOW + GRACE_MS).toISOString() },
      { hash: "", expiresAt: new Date(NOW + GRACE_MS).toISOString() },
      { hash: "no-expiry" },
      { hash: "unparseable", expiresAt: "not-a-date" },
      "a string",
      null,
      ["nested"],
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.hash).toBe("kept");
  });

  test("refuses a non-array column", () => {
    expect(readRetiredRefreshTokens({ hash: "x" })).toEqual([]);
    expect(readRetiredRefreshTokens("[]")).toEqual([]);
  });
});

describe("pruneRetiredRefreshTokens", () => {
  test("keeps live entries and drops closed windows", () => {
    const entries = [
      entry("expired", -1),
      entry("live", GRACE_MS),
      entry("exactly-now", 0),
    ];

    expect(pruneRetiredRefreshTokens(entries, NOW).map((e) => e.hash)).toEqual([
      "live",
    ]);
  });
});

describe("isRetiredRefreshTokenAccepted", () => {
  const entries = [entry("retired", GRACE_MS)];

  test("accepts a retired hash inside its window", () => {
    expect(isRetiredRefreshTokenAccepted(entries, "retired", NOW)).toBe(true);
  });

  test("rejects the same hash once the window closes", () => {
    expect(
      isRetiredRefreshTokenAccepted(entries, "retired", NOW + GRACE_MS),
    ).toBe(false);
  });

  test("rejects a hash that was never issued", () => {
    expect(isRetiredRefreshTokenAccepted(entries, "forged", NOW)).toBe(false);
  });
});

describe("retainSupersededRefreshToken", () => {
  test("retires the hash it replaces and stamps the deadline once", () => {
    const first = retainSupersededRefreshToken([], "t0", NOW, GRACE_MS);

    expect(first).toEqual([
      { hash: "t0", expiresAt: new Date(NOW + GRACE_MS).toISOString() },
    ]);
  });

  test("retains the superseded current token when a retired one is replayed", () => {
    // Two tabs hold t0. Tab A rotates to t1; tab B then presents t0, which is
    // retired but live. Retiring t1 as well is what lets tab A keep working
    // instead of trading one stranded client for another.
    const afterFirstRotation = retainSupersededRefreshToken(
      [],
      "t0",
      NOW,
      GRACE_MS,
    );
    const afterReplay = retainSupersededRefreshToken(
      afterFirstRotation,
      "t1",
      NOW + 1_000,
      GRACE_MS,
    );

    expect(afterReplay.map((e) => e.hash)).toEqual(["t0", "t1"]);
    // t0 keeps the deadline it was given, so a retry cannot extend its window.
    expect(afterReplay[0]?.expiresAt).toBe(
      new Date(NOW + GRACE_MS).toISOString(),
    );
    expect(afterReplay[1]?.expiresAt).toBe(
      new Date(NOW + 1_000 + GRACE_MS).toISOString(),
    );
  });

  test("drops expired entries before applying the cap", () => {
    const stale = Array.from({ length: MAX_RETAINED_REFRESH_TOKENS }, (_, i) =>
      entry(`stale-${i}`, -1),
    );

    const retained = retainSupersededRefreshToken(stale, "t0", NOW, GRACE_MS);

    expect(retained.map((e) => e.hash)).toEqual(["t0"]);
  });

  test("keeps only the most recent entries", () => {
    let retained: RetiredRefreshToken[] = [];
    for (let i = 0; i < MAX_RETAINED_REFRESH_TOKENS + 3; i += 1) {
      retained = retainSupersededRefreshToken(
        retained,
        `t${i}`,
        NOW + i,
        GRACE_MS,
      );
    }

    expect(retained).toHaveLength(MAX_RETAINED_REFRESH_TOKENS);
    expect(retained.map((e) => e.hash)).toEqual(["t3", "t4", "t5", "t6", "t7"]);
  });

  test("grace of zero stops recording new retirements", () => {
    expect(retainSupersededRefreshToken([], "t0", NOW, 0)).toEqual([]);
  });

  test("grace of zero keeps entries that have not expired yet", () => {
    // Narrowing the setting takes effect as recorded windows close, rather
    // than invalidating a client that is mid-retry the moment it is applied.
    const live = entry("t0", GRACE_MS);

    expect(retainSupersededRefreshToken([live], "t1", NOW, 0)).toEqual([live]);
    expect(
      retainSupersededRefreshToken([entry("stale", -1)], "t1", NOW, 0),
    ).toEqual([]);
  });
});
