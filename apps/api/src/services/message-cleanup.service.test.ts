import { describe, expect, test } from "bun:test";
import {
  getMessageCleanupConfig,
  getMessageCleanupStatus,
  initializeMessageCleanup,
  isMessageCleanupInitialized,
  runCleanupCycle,
  setMessageCleanupConfig,
  shutdownMessageCleanup,
} from "./message-cleanup.service.js";

const COMPANIES = [{ id: "company-a" }, { id: "company-b" }];

/**
 * The cycle runs two independent maintenance tasks per tenant: expiring stuck
 * pending sends, and releasing stranded media download claims. They share a
 * loop for convenience, not because they depend on each other - so a failure
 * in either must not discard the other's work, and neither must stop the
 * remaining tenants.
 */
describe("cleanup cycle error isolation", () => {
  test("a media sweep failure does not discard that tenant's message cleanup", async () => {
    const result = await runCleanupCycle({
      listCompanies: async () => [{ id: "company-a" }],
      cleanupMessages: async () => 7,
      releaseMedia: async () => {
        throw new Error("media sweep exploded");
      },
    });

    // The message cleanup completed; its count must still be reported rather
    // than replaced by an error entry.
    expect(result.companies).toEqual([
      { companyId: "company-a", expiredCount: 7 },
    ]);
    expect(result.totalExpired).toBe(7);
  });

  test("a media sweep failure does not stop the remaining tenants", async () => {
    const swept: string[] = [];
    const result = await runCleanupCycle({
      listCompanies: async () => COMPANIES,
      cleanupMessages: async () => 1,
      releaseMedia: async (companyId) => {
        swept.push(companyId);
        if (companyId === "company-a") throw new Error("boom");
        return 0;
      },
    });

    // Both tenants are swept; their order is not guaranteed now that tenants
    // are processed concurrently.
    expect([...swept].sort()).toEqual(["company-a", "company-b"]);
    expect(result.totalProcessed).toBe(2);
    expect(result.totalExpired).toBe(2);
  });

  test("a message cleanup failure still lets the media sweep run", async () => {
    // The reverse direction: the sweep is not skipped just because the
    // message cleanup for that tenant threw.
    const swept: string[] = [];
    const result = await runCleanupCycle({
      listCompanies: async () => [{ id: "company-a" }],
      cleanupMessages: async () => {
        throw new Error("cleanup exploded");
      },
      releaseMedia: async (companyId) => {
        swept.push(companyId);
        return 3;
      },
    });

    expect(swept).toEqual(["company-a"]);
    expect(result.companies[0]).toMatchObject({
      companyId: "company-a",
      expiredCount: 0,
      error: "cleanup exploded",
    });
  });

  test("a message cleanup failure does not stop the remaining tenants", async () => {
    const cleaned: string[] = [];
    const result = await runCleanupCycle({
      listCompanies: async () => COMPANIES,
      cleanupMessages: async (companyId) => {
        cleaned.push(companyId);
        if (companyId === "company-a") throw new Error("boom");
        return 5;
      },
      releaseMedia: async () => 0,
    });

    // Order is not guaranteed under concurrent processing; both ran.
    expect([...cleaned].sort()).toEqual(["company-a", "company-b"]);
    expect(result.totalExpired).toBe(5);
    expect(result.companies).toHaveLength(2);
  });

  test("both tasks failing for one tenant still leaves the others intact", async () => {
    const result = await runCleanupCycle({
      listCompanies: async () => COMPANIES,
      cleanupMessages: async (companyId) => {
        if (companyId === "company-a") throw new Error("cleanup boom");
        return 4;
      },
      releaseMedia: async (companyId) => {
        if (companyId === "company-a") throw new Error("media boom");
        return 0;
      },
    });

    expect(result.totalProcessed).toBe(2);
    expect(result.totalExpired).toBe(4);
    expect(result.companies[0].error).toBe("cleanup boom");
    expect(result.companies[1]).toEqual({
      companyId: "company-b",
      expiredCount: 4,
    });
  });

  test("no companies short-circuits without calling either task", async () => {
    let called = false;
    const result = await runCleanupCycle({
      listCompanies: async () => [],
      cleanupMessages: async () => {
        called = true;
        return 0;
      },
      releaseMedia: async () => {
        called = true;
        return 0;
      },
    });

    expect(result.skipped).toBe(true);
    expect(called).toBe(false);
  });
});

/**
 * The completion-driven timer must neither overlap a slow cycle nor outlive
 * shutdown.
 */
describe("cleanup service lifecycle", () => {
  test("a slow cycle cannot overlap and shutdown awaits its completion", async () => {
    const original = getMessageCleanupConfig();
    let cleanupCalls = 0;
    let releaseSlowCycle!: () => void;
    let signalSlowCycleStarted!: () => void;
    let signalSlowCycleFinished!: () => void;
    const slowCycleStarted = new Promise<void>((resolve) => {
      signalSlowCycleStarted = resolve;
    });
    const slowCycleFinished = new Promise<void>((resolve) => {
      signalSlowCycleFinished = resolve;
    });
    const slowCycleGate = new Promise<void>((resolve) => {
      releaseSlowCycle = resolve;
    });

    try {
      await initializeMessageCleanup(
        { enabled: true, intervalMinutes: 0.0001 },
        {
          listCompanies: async () => [{ id: "company-a" }],
          cleanupMessages: async () => {
            cleanupCalls++;
            if (cleanupCalls === 2) {
              signalSlowCycleStarted();
              await slowCycleGate;
              signalSlowCycleFinished();
            }
            return 0;
          },
          releaseMedia: async () => 0,
        },
      );

      await slowCycleStarted;
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Several nominal intervals elapsed while call two was blocked. An
      // interval-driven scheduler would have started calls three and four.
      expect(cleanupCalls).toBe(2);

      let shutdownResolved = false;
      const shutdown = shutdownMessageCleanup().then(() => {
        shutdownResolved = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(shutdownResolved).toBe(false);

      releaseSlowCycle();
      await slowCycleFinished;
      await shutdown;
      expect(shutdownResolved).toBe(true);
    } finally {
      releaseSlowCycle();
      await shutdownMessageCleanup();
      setMessageCleanupConfig(original);
    }
  });

  test("shutdown is safe before initialization and is idempotent", async () => {
    await shutdownMessageCleanup();
    await shutdownMessageCleanup();
    expect(isMessageCleanupInitialized()).toBe(false);
  });

  test("status reports disabled without claiming to be running", () => {
    const original = getMessageCleanupConfig();
    try {
      setMessageCleanupConfig({ enabled: false });
      expect(getMessageCleanupStatus()).toBe("disabled");
      setMessageCleanupConfig({ enabled: true });
      // Enabled but not initialized must read as stopped, not running.
      expect(getMessageCleanupStatus()).toBe("stopped");
    } finally {
      setMessageCleanupConfig(original);
    }
  });

  test("a disabled cycle short-circuits without touching collaborators", async () => {
    const original = getMessageCleanupConfig();
    let called = false;
    try {
      setMessageCleanupConfig({ enabled: false });
      const result = await runCleanupCycle({
        listCompanies: async () => {
          called = true;
          return COMPANIES;
        },
      });
      expect(result.skipped).toBe(true);
      expect(called).toBe(false);
    } finally {
      setMessageCleanupConfig(original);
    }
  });
});

/**
 * Every API replica boots the cleanup service, so a whole-cycle advisory lock
 * elects a single leader per cycle. The lock is injected here to prove the
 * scheduler honours it without needing a database.
 */
describe("cross-replica leadership", () => {
  test("a replica that does not hold the lock skips the cycle entirely", async () => {
    const original = getMessageCleanupConfig();
    let cycleRan = false;
    try {
      await initializeMessageCleanup(
        { enabled: true, intervalMinutes: 60 },
        {
          listCompanies: async () => {
            // Reached only if the non-leader wrongly ran the cycle.
            cycleRan = true;
            return COMPANIES;
          },
          cleanupMessages: async () => 0,
          releaseMedia: async () => 0,
        },
        // Non-leader: lock held elsewhere, so onAcquired must never run.
        { run: async () => ({ acquired: false }) },
      );

      expect(cycleRan).toBe(false);
    } finally {
      await shutdownMessageCleanup();
      setMessageCleanupConfig(original);
    }
  });

  test("the leader runs the cycle and releases the lock afterwards", async () => {
    const original = getMessageCleanupConfig();
    let companiesListed = 0;
    let released = 0;
    try {
      await initializeMessageCleanup(
        { enabled: true, intervalMinutes: 60 },
        {
          listCompanies: async () => {
            companiesListed++;
            return [{ id: "company-a" }];
          },
          cleanupMessages: async () => 0,
          releaseMedia: async () => 0,
        },
        // Leader: run the cycle, and record that release happened after it.
        {
          run: async (onAcquired) => {
            const result = await onAcquired();
            released++;
            return { acquired: true, result };
          },
        },
      );

      expect(companiesListed).toBe(1);
      expect(released).toBe(1);
    } finally {
      await shutdownMessageCleanup();
      setMessageCleanupConfig(original);
    }
  });
});

/**
 * Tenants are processed with bounded parallelism so a cycle's wall-clock is
 * roughly total/concurrency rather than the sum of every tenant's work. The
 * cap must hold so the cycle never drains the shared tenant connection pool.
 */
describe("cleanup cycle concurrency", () => {
  const FOUR = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  test("runs multiple tenants at once but never more than the configured cap", async () => {
    const original = getMessageCleanupConfig();
    try {
      setMessageCleanupConfig({ concurrency: 2 });
      let inFlight = 0;
      let maxInFlight = 0;
      const result = await runCleanupCycle({
        listCompanies: async () => FOUR,
        cleanupMessages: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Bun.sleep(15);
          inFlight -= 1;
          return 0;
        },
        releaseMedia: async () => 0,
      });

      // Reached the cap (proving parallelism) and never exceeded it.
      expect(maxInFlight).toBe(2);
      expect(result.totalProcessed).toBe(4);
      expect(result.companies.map((c) => c.companyId)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    } finally {
      setMessageCleanupConfig(original);
    }
  });

  test("concurrency of 1 processes tenants strictly one at a time", async () => {
    const original = getMessageCleanupConfig();
    try {
      setMessageCleanupConfig({ concurrency: 1 });
      let inFlight = 0;
      let maxInFlight = 0;
      await runCleanupCycle({
        listCompanies: async () => FOUR,
        cleanupMessages: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Bun.sleep(5);
          inFlight -= 1;
          return 0;
        },
        releaseMedia: async () => 0,
      });

      expect(maxInFlight).toBe(1);
    } finally {
      setMessageCleanupConfig(original);
    }
  });
});
