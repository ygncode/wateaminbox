import { describe, expect, test } from "bun:test";
import {
  type DependencyProbes,
  evaluateReadiness,
  probeDependencies,
  type ReadinessChecks,
} from "./health.js";

const healthy: ReadinessChecks = {
  postgres: true,
  nats: true,
  eventConsumer: true,
  centrifugo: { configured: true, reachable: true },
};

describe("readiness policy", () => {
  test("PostgreSQL failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, postgres: false })).toBe("unready");
  });

  test("shared rate-limiter failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, rateLimiter: false })).toBe(
      "unready",
    );
  });

  test("NATS or event consumer failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, nats: false })).toBe("unready");
    expect(evaluateReadiness({ ...healthy, eventConsumer: false })).toBe(
      "unready",
    );
  });

  test("Centrifugo issues degrade without rejecting REST traffic", () => {
    expect(
      evaluateReadiness({
        ...healthy,
        centrifugo: { configured: false, reachable: false },
      }),
    ).toBe("degraded");
    expect(
      evaluateReadiness({
        ...healthy,
        centrifugo: { configured: true, reachable: false },
      }),
    ).toBe("degraded");
  });

  test("all required checks report ready", () => {
    expect(evaluateReadiness(healthy)).toBe("ready");
  });
});

const probes = (overrides: Partial<DependencyProbes> = {}): DependencyProbes => ({
  pingPostgres: async () => undefined,
  loadOutboxBacklog: async () => ({ pending: 0, oldestPendingAt: null }),
  healthCheckRateLimiter: async () => true,
  rateLimiterEnabled: true,
  ...overrides,
});

describe("dependency probes", () => {
  test("still checks the rate limiter when the outbox backlog scan throws", async () => {
    // The backlog is informational payload. Before the probes were isolated a
    // throw here skipped the rate-limiter check, leaving its fallback in
    // place, so a healthy replica reported rateLimiter: false and 503'd.
    const checks = await probeDependencies(
      probes({
        loadOutboxBacklog: async () => {
          throw new Error("outbox backlog scan failed");
        },
        healthCheckRateLimiter: async () => true,
      }),
    );

    expect(checks.postgres).toBe(true);
    expect(checks.rateLimiter).toBe(true);
    expect(checks.outboxBacklogError).toBe(true);

    expect(
      evaluateReadiness({
        ...healthy,
        postgres: checks.postgres,
        rateLimiter: checks.rateLimiter,
      }),
    ).toBe("ready");
  });

  test("reports a failed backlog scan instead of a healthy zero backlog", async () => {
    const checks = await probeDependencies(
      probes({
        loadOutboxBacklog: async () => {
          throw new Error("outbox backlog scan failed");
        },
      }),
    );

    expect(checks.outboxBacklogError).toBe(true);
    expect(checks.outboxBacklog).toEqual({ pending: 0, oldestPendingAt: null });
  });

  test("carries the real backlog through when the scan succeeds", async () => {
    const oldestPendingAt = new Date("2026-09-11T00:00:00.000Z");
    const checks = await probeDependencies(
      probes({
        loadOutboxBacklog: async () => ({ pending: 7, oldestPendingAt }),
      }),
    );

    expect(checks.outboxBacklogError).toBe(false);
    expect(checks.outboxBacklog).toEqual({ pending: 7, oldestPendingAt });
  });

  test("fails closed when the rate-limiter store is unreachable", async () => {
    const checks = await probeDependencies(
      probes({
        healthCheckRateLimiter: async () => {
          throw new Error("rate limit store unreachable");
        },
      }),
    );

    expect(checks.rateLimiter).toBe(false);
    expect(
      evaluateReadiness({ ...healthy, rateLimiter: checks.rateLimiter }),
    ).toBe("unready");
  });

  test("passes the rate limiter when the store exposes no health check", async () => {
    const checks = await probeDependencies(
      probes({ healthCheckRateLimiter: undefined }),
    );

    expect(checks.rateLimiter).toBe(true);
  });

  test("leaves a disabled rate limiter alone when the database is unreachable", async () => {
    const checks = await probeDependencies(
      probes({
        pingPostgres: async () => {
          throw new Error("postgres down");
        },
        rateLimiterEnabled: false,
      }),
    );

    expect(checks.postgres).toBe(false);
    expect(checks.rateLimiter).toBe(true);
    expect(checks.outboxBacklogError).toBe(false);
  });

  test("does not run the database-backed probes when PostgreSQL is down", async () => {
    let backlogQueries = 0;
    let rateLimiterQueries = 0;

    const checks = await probeDependencies(
      probes({
        pingPostgres: async () => {
          throw new Error("postgres down");
        },
        loadOutboxBacklog: async () => {
          backlogQueries += 1;
          return { pending: 0, oldestPendingAt: null };
        },
        healthCheckRateLimiter: async () => {
          rateLimiterQueries += 1;
          return true;
        },
      }),
    );

    // PostgreSQL gates readiness, and every later probe is database-backed, so
    // neither should be attempted and neither failure should be reported.
    expect(backlogQueries).toBe(0);
    expect(rateLimiterQueries).toBe(0);
    expect(checks.postgres).toBe(false);
    expect(checks.rateLimiter).toBe(false);
    expect(checks.outboxBacklogError).toBe(false);
  });
});
