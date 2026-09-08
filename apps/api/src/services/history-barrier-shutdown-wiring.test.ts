import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { QueryExecutor } from "kysely";

// lib/env.ts validates at module load. NODE_ENV defaults to "development"
// (so production-only credential checks are skipped), but
// validateSigningSecrets runs in every environment and rejects blank
// JWT_SECRET / CENTRIFUGO_TOKEN_HMAC_SECRET. apps/api/bunfig.toml preloads
// src/test-env.ts which injects those; set them here too so this file is
// self-contained when run in isolation (`bun test <this file>`).
process.env.NODE_ENV ??= "development";
process.env.JWT_SECRET ??= "test-only-jwt-signing-secret-with-enough-entropy-1";
process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ??=
  "test-only-centrifugo-signing-secret-with-entropy-2";

/**
 * The history barrier drain is a 1-second self-rescheduling `setTimeout`
 * whose only stop signal is `stopHistoryBarrierDrain` (private module state
 * in history-apply-barrier.service.ts). `initializeMessageHandler` starts it
 * alongside the NATS event supervisor; the `nats` shutdown step must
 * therefore stop BOTH loops, which is exactly what `shutdownMessageHandler`
 * does (`stopHistoryBarrierDrain` then `natsLifecycle.shutdown`).
 *
 * This suite pins the shutdown wiring from two angles:
 *
 *  1. `shutdownMessageHandler()` -- the action the `nats` step is now wired
 *     to -- DOES stop the drain, then shuts down NATS. Guards against a
 *     future change that breaks `shutdownMessageHandler`'s drain-stopping.
 *  2. A contract test that pins the wiring itself in `index.ts`: the `nats`
 *     step must run `shutdownMessageHandler`, not the bare
 *     `natsLifecycle.shutdown()` that the bug left behind.
 *
 * Mocking is surgical: every drain tick runs a Kysely `sql` SELECT against
 * the shared `db`, calling `db.getExecutor()`. A `spyOn` on that one method
 * returns a stub executor whose `executeQuery` resolves with empty rows and
 * increments a counter, so each tick is fast, deterministic, and observable.
 * `mockRestore()` in afterEach returns the real executor to the rest of the
 * suite; no `mock.module` is used, so the rest of `@wateaminbox/database`'s
 * exports (e.g. reconcileTenantSchema) stay intact. The real NATS lifecycle
 * and the real drain re-arming logic (`.catch` + `.finally`) run unmodified.
 */
const counter = { ticks: 0 };

// Kysely 0.28.x RawBuilderImpl.execute(provider) calls provider.getExecutor(),
// then executor.transformQuery -> executor.compileQuery -> executor
// .executeQuery. The with* methods are present so that if a builder ever
// carries plugins the chain still resolves to this stub executor.
function makeExecutor(): QueryExecutor {
  const executor = {
    adapter: {},
    plugins: [] as readonly unknown[],
    transformQuery: (node: unknown) => node,
    compileQuery: () => ({
      sql: "",
      parameters: [] as readonly unknown[],
      query: { kind: "RawNode" },
    }),
    withPlugins: () => executor,
    withPlugin: () => executor,
    withPluginAtFront: () => executor,
    withoutPlugins: () => executor,
    withConnectionProvider: () => executor,
    executeQuery: async () => {
      counter.ticks++;
      return { rows: [] };
    },
  } as unknown as QueryExecutor;
  return executor;
}

const [{ db }, { startHistoryBarrierDrain, stopHistoryBarrierDrain }] =
  await Promise.all([
    import("@wateaminbox/database"),
    import("./history-apply-barrier.service.js"),
  ]);
const { shutdownMessageHandler } = await import("./message-handler.js");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until at least `min` drain ticks have landed since this call. */
async function waitForTicks(min: number, timeoutMs = 6_000): Promise<void> {
  const start = Date.now();
  const baseline = counter.ticks;
  while (counter.ticks - baseline < min) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${min} drain ticks; got ${counter.ticks - baseline}`,
      );
    }
    await sleep(50);
  }
}

const noApply = async (): Promise<void> => {};

describe("history-barrier drain shutdown wiring", () => {
  // Replaced per test so the executor (and its captured counter) is fresh, and
  // restored afterward so the rest of the suite sees the real Kysely executor.
  let getExecutorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    counter.ticks = 0;
    getExecutorSpy = spyOn(db, "getExecutor").mockImplementation(() =>
      makeExecutor(),
    );
  });

  afterEach(async () => {
    getExecutorSpy.mockRestore();
    // Prevent the leaked loop from running across tests. stopHistoryBarrierDrain
    // is idempotent: a second call hits `stopped === true` and awaits an
    // already-settled `pending`.
    await stopHistoryBarrierDrain();
  });

  test("shutdownMessageHandler stops the history-barrier drain loop", async () => {
    startHistoryBarrierDrain(noApply);
    await waitForTicks(2);

    const before = counter.ticks;

    // The action the `nats` shutdown step is now wired to. It stops the
    // drain, then shuts down NATS -- both producers initializeMessageHandler
    // started, in the order it started them.
    await shutdownMessageHandler();

    await sleep(2_500);
    // stopHistoryBarrierDrain flipped `stopped` and cleared the timer; no
    // further ticks fire. This is the behaviour the `nats` shutdown step now
    // guarantees, which the bare natsLifecycle.shutdown() cannot.
    expect(counter.ticks - before).toBe(0);
  }, 15_000);
});

/**
 * The fix is a wiring change in the entrypoint, so none of the behavioural
 * tests above can fail on a revert -- `shutdownMessageHandler` and
 * `stopHistoryBarrierDrain` behave the same whether or not index.ts calls
 * them. This contract test pins the wiring itself: the `nats` shutdown step
 * must run `shutdownMessageHandler` (which stops the drain THEN shuts down
 * NATS), not the bare `natsLifecycle.shutdown()` that 93ddaf6 left behind.
 * It fails before the fix (shutdownMessageHandler is not referenced in
 * index.ts at all) and passes after.
 */
describe("nats shutdown step wiring contract", () => {
  test("the `nats` shutdown step is wired to shutdownMessageHandler", async () => {
    const indexSource = await Bun.file(
      new URL("../index.ts", import.meta.url),
    ).text();

    // The paired shutdown is imported from the message handler.
    expect(indexSource).toContain("shutdownMessageHandler");
    // ...and is the `nats` step's run action, not a bare natsLifecycle call.
    expect(indexSource).toMatch(
      /name:\s*"nats",\s*run:\s*shutdownMessageHandler/,
    );
  });
});
