import { describe, expect, test } from "bun:test";
import {
  restoreSession,
  SESSION_RECOVERY_DELAYS_MS,
  type SessionAttemptResult,
} from "./session-restore";

/**
 * The distinction under test: "the API refused us" and "the API did not answer"
 * must not collapse into the same result. A deployment produces the second, and
 * a browser that treats it as the first sends every user to the login screen
 * for a session that is still perfectly valid.
 */

function scriptedAttempts(results: SessionAttemptResult[]) {
  const calls = { count: 0 };
  const attempt = async (): Promise<SessionAttemptResult> => {
    const result = results[Math.min(calls.count, results.length - 1)];
    calls.count += 1;
    return result ?? "unavailable";
  };
  return { attempt, calls };
}

const noSleep = async () => {};

describe("restoreSession", () => {
  test("succeeds without sleeping when the first attempt works", async () => {
    const { attempt, calls } = scriptedAttempts(["loaded"]);
    const slept: number[] = [];

    expect(
      await restoreSession(attempt, {
        sleep: async (ms) => void slept.push(ms),
      }),
    ).toBe("loaded");
    expect(calls.count).toBe(1);
    expect(slept).toEqual([]);
  });

  test("retries while the API is unreachable and succeeds once it answers", async () => {
    const { attempt, calls } = scriptedAttempts([
      "unavailable",
      "unavailable",
      "loaded",
    ]);
    const slept: number[] = [];

    expect(
      await restoreSession(attempt, {
        sleep: async (ms) => void slept.push(ms),
      }),
    ).toBe("loaded");
    expect(calls.count).toBe(3);
    // The pauses come from the published schedule, in order.
    expect(slept).toEqual([
      SESSION_RECOVERY_DELAYS_MS[0],
      SESSION_RECOVERY_DELAYS_MS[1],
    ]);
  });

  test("reports an unverified session - not a rejection - once the schedule runs out", async () => {
    const { attempt, calls } = scriptedAttempts(["unavailable"]);

    expect(await restoreSession(attempt, { sleep: noSleep })).toBe(
      "unverified",
    );
    expect(calls.count).toBe(SESSION_RECOVERY_DELAYS_MS.length + 1);
  });

  test("treats a refusal as terminal and stops retrying", async () => {
    // Retrying a refusal would be pointless, and it is the one case where the
    // caller must stop preserving local state.
    const { attempt, calls } = scriptedAttempts([
      "unavailable",
      "rejected",
      "loaded",
    ]);

    expect(await restoreSession(attempt, { sleep: noSleep })).toBe("rejected");
    expect(calls.count).toBe(2);
  });

  test("changing its mind to unverified keeps the retry window bounded", async () => {
    const { attempt, calls } = scriptedAttempts(["unavailable"]);

    await restoreSession(attempt, { delaysMs: [10, 20], sleep: noSleep });

    expect(calls.count).toBe(3);
  });

  test("an empty schedule still makes one attempt before giving up", async () => {
    // An operator disabling retries must not also disable the attempt.
    const { attempt, calls } = scriptedAttempts(["loaded"]);

    expect(
      await restoreSession(attempt, { delaysMs: [], sleep: noSleep }),
    ).toBe("loaded");
    expect(calls.count).toBe(1);

    const failing = scriptedAttempts(["unavailable"]);
    expect(
      await restoreSession(failing.attempt, { delaysMs: [], sleep: noSleep }),
    ).toBe("unverified");
    expect(failing.calls.count).toBe(1);
  });

  test("the shipped schedule outlasts a container replacement", async () => {
    // Compose stops the old API container, starts its replacement, and waits
    // for its health check. A schedule shorter than that is decoration.
    const total = SESSION_RECOVERY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);

    expect(total).toBeGreaterThanOrEqual(10_000);
  });
});
