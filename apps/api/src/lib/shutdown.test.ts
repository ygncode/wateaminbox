import { describe, expect, test } from "bun:test";

import {
  runShutdown,
  type ShutdownStep,
  type ShutdownStepResult,
} from "./shutdown.js";

/** A promise the test resolves by hand, so no step depends on wall-clock time. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Never settles: the hung drain this whole module exists to bound. */
const hangs = (): Promise<void> => new Promise<void>(() => {});

function recordingStep(name: string, order: string[]): ShutdownStep {
  return {
    name,
    run: () => {
      order.push(name);
    },
  };
}

function statuses(steps: readonly ShutdownStepResult[]): string[] {
  return steps.map((step) => `${step.name}:${step.status}`);
}

describe("runShutdown", () => {
  test("runs every step in the declared order", async () => {
    const order: string[] = [];
    const result = await runShutdown({
      deadlineMs: 1_000,
      steps: [
        recordingStep("http-server", order),
        recordingStep("consumers", order),
        recordingStep("nats", order),
        recordingStep("pools", order),
      ],
    });

    expect(order).toEqual(["http-server", "consumers", "nats", "pools"]);
    expect(result.timedOut).toBe(false);
    expect(statuses(result.steps)).toEqual([
      "http-server:completed",
      "consumers:completed",
      "nats:completed",
      "pools:completed",
    ]);
  });

  test("waits for each step before starting the next", async () => {
    const order: string[] = [];
    const gate = deferred();

    const running = runShutdown({
      deadlineMs: 1_000,
      steps: [
        {
          name: "slow",
          run: async () => {
            order.push("slow:start");
            await gate.promise;
            order.push("slow:end");
          },
        },
        recordingStep("next", order),
      ],
    });

    // The second step must not have run while the first is still pending.
    await Promise.resolve();
    expect(order).toEqual(["slow:start"]);

    gate.resolve();
    await running;
    expect(order).toEqual(["slow:start", "slow:end", "next"]);
  });

  test("a hung step cannot block exit and ends the sequence", async () => {
    const order: string[] = [];
    const result = await runShutdown({
      deadlineMs: 25,
      steps: [
        recordingStep("http-server", order),
        { name: "nats-drain", run: hangs },
        recordingStep("pools", order),
      ],
    });

    expect(result.timedOut).toBe(true);
    expect(statuses(result.steps)).toEqual([
      "http-server:completed",
      "nats-drain:timed-out",
      "pools:skipped",
    ]);
    // The step after the hang never ran, rather than running unbounded.
    expect(order).toEqual(["http-server"]);
  });

  test("the budget is shared across steps, not granted per step", async () => {
    const result = await runShutdown({
      deadlineMs: 25,
      steps: [
        { name: "first-hang", run: hangs },
        { name: "second-hang", run: hangs },
      ],
    });

    expect(statuses(result.steps)).toEqual([
      "first-hang:timed-out",
      "second-hang:skipped",
    ]);
  });

  test("a failing step is recorded and the rest still run", async () => {
    const order: string[] = [];
    const failure = new Error("drain refused");

    const result = await runShutdown({
      deadlineMs: 1_000,
      steps: [
        {
          name: "nats",
          run: () => {
            throw failure;
          },
        },
        recordingStep("pools", order),
      ],
    });

    expect(result.timedOut).toBe(false);
    expect(statuses(result.steps)).toEqual(["nats:failed", "pools:completed"]);
    expect(result.steps[0]?.error).toBe(failure);
    // Releasing the pools matters most; a broken dependency must not skip it.
    expect(order).toEqual(["pools"]);
  });

  test("an asynchronous rejection is reported like a synchronous throw", async () => {
    const result = await runShutdown({
      deadlineMs: 1_000,
      steps: [
        { name: "pools", run: async () => Promise.reject(new Error("x")) },
      ],
    });

    expect(statuses(result.steps)).toEqual(["pools:failed"]);
  });

  test("reports each outcome as it happens", async () => {
    const seen: string[] = [];
    await runShutdown({
      deadlineMs: 25,
      steps: [
        { name: "ok", run: () => {} },
        { name: "stuck", run: hangs },
        { name: "after", run: () => {} },
      ],
      onResult: ({ name, status }) => seen.push(`${name}:${status}`),
    });

    expect(seen).toEqual(["ok:completed", "stuck:timed-out", "after:skipped"]);
  });

  test("an exhausted budget skips remaining steps without running them", async () => {
    const order: string[] = [];
    const result = await runShutdown({
      deadlineMs: 0,
      steps: [recordingStep("never", order)],
    });

    expect(result.timedOut).toBe(true);
    expect(statuses(result.steps)).toEqual(["never:skipped"]);
    expect(order).toEqual([]);
  });

  test("no steps is a clean shutdown", async () => {
    const result = await runShutdown({ deadlineMs: 1_000, steps: [] });

    expect(result.timedOut).toBe(false);
    expect(result.steps).toEqual([]);
  });
});
