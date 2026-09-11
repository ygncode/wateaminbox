/**
 * Health Check Routes
 *
 * These endpoints use raw `c.json()` responses intentionally.
 * They are infrastructure endpoints designed for Kubernetes/Docker health probes,
 * not API endpoints. Monitoring tools expect specific simple JSON formats.
 *
 * Do NOT refactor these to use response helpers like `successData()`.
 */
import { db } from "@wateaminbox/database";
import { toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { sql } from "kysely";
import { env } from "../lib/env.js";
import { natsLifecycle } from "../lib/nats/index.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { isCentrifugoReachable } from "../lib/realtime.js";
import {
  type CommandOutboxBacklog,
  getCommandOutboxBacklog,
  getCommandOutboxHealth,
} from "../services/command-outbox.service.js";
import { getMessageCleanupStatus } from "../services/message-cleanup.service.js";
import { getMessageSearchHealth } from "../services/message-search-outbox.service.js";
import { getScheduledMessageHealth } from "../services/scheduled-message.service.js";

export const healthRoutes = new Hono();

export type ReadinessChecks = {
  postgres: boolean;
  rateLimiter?: boolean;
  nats: boolean;
  eventConsumer: boolean;
  centrifugo: { configured: boolean; reachable: boolean };
};

export function evaluateReadiness(
  checks: ReadinessChecks,
): "ready" | "degraded" | "unready" {
  if (!checks.postgres || checks.rateLimiter === false) return "unready";
  if (!checks.nats || !checks.eventConsumer) return "unready";
  return !checks.centrifugo.configured || !checks.centrifugo.reachable
    ? "degraded"
    : "ready";
}

/**
 * Result of the async dependency probes. `rateLimiter` is `undefined` only for
 * the value `evaluateReadiness` treats as "not applicable".
 */
export type DependencyChecks = {
  postgres: boolean;
  rateLimiter: boolean | undefined;
  outboxBacklog: CommandOutboxBacklog;
  outboxBacklogError: boolean;
};

/**
 * Injectable seams so the failure-isolation rules below stay testable without
 * a live PostgreSQL, NATS, or tenant pool.
 */
export type DependencyProbes = {
  pingPostgres: () => Promise<unknown>;
  loadOutboxBacklog: () => Promise<CommandOutboxBacklog>;
  healthCheckRateLimiter: (() => Promise<boolean>) | undefined;
  rateLimiterEnabled: boolean;
};

const defaultProbes = (): DependencyProbes => ({
  pingPostgres: () => sql`SELECT 1`.execute(db),
  loadOutboxBacklog: () => getCommandOutboxBacklog(),
  healthCheckRateLimiter: rateLimitStore.healthCheck
    ? () => rateLimitStore.healthCheck!()
    : undefined,
  rateLimiterEnabled: rateLimitConfig.enabled,
});

/**
 * Probes the dependencies that gate readiness.
 *
 * Each probe is isolated on purpose. PostgreSQL stays the source of truth and
 * still short-circuits the two database-backed checks, but the informational
 * outbox backlog scan must not share a `try` block with the rate-limiter
 * check: a backlog scan that throws would skip the rate-limiter probe and
 * leave its fallback value in place, reporting a healthy shared rate limiter
 * as down (HTTP 503) and blaming the wrong subsystem.
 */
export async function probeDependencies(
  probes: DependencyProbes = defaultProbes(),
): Promise<DependencyChecks> {
  const checks: DependencyChecks = {
    postgres: false,
    // Nothing to reach when rate limiting is off, so the check passes
    // vacuously rather than reporting a fault that cannot exist.
    rateLimiter: !probes.rateLimiterEnabled,
    outboxBacklog: { pending: 0, oldestPendingAt: null },
    outboxBacklogError: false,
  };

  try {
    await probes.pingPostgres();
    checks.postgres = true;
  } catch {
    // PostgreSQL is the source of truth and therefore gates readiness.
    return checks;
  }

  try {
    checks.outboxBacklog = await probes.loadOutboxBacklog();
  } catch {
    // Informational payload only. Record the failure so the probe body does
    // not read as a healthy zero backlog, and carry on.
    checks.outboxBacklogError = true;
  }

  if (!probes.healthCheckRateLimiter) {
    checks.rateLimiter = true;
    return checks;
  }

  try {
    checks.rateLimiter = await probes.healthCheckRateLimiter();
  } catch {
    // A store that cannot be reached cannot enforce the shared budget, so
    // readiness has to fail closed rather than assume the limiter is intact.
    checks.rateLimiter = false;
  }

  return checks;
}

/**
 * GET /health - Overall system health
 * Used by orchestrators to check if the service is functioning
 */
healthRoutes.get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: toISOString(),
    services: {
      messageCleanup: getMessageCleanupStatus(),
      realtime: "centrifugo",
    },
  });
});

/**
 * GET /health/ready - Readiness probe
 * Kubernetes uses this to determine if the pod is ready to receive traffic
 */
healthRoutes.get("/ready", async (c) => {
  const natsState = natsLifecycle.getReadinessState();
  const dependencies = await probeDependencies();
  const checks = {
    postgres: dependencies.postgres,
    rateLimiter: dependencies.rateLimiter,
    nats: natsState.nats.connected,
    eventConsumer: natsState.eventConsumer.active,
    outbox: getCommandOutboxHealth(),
    messageSearch: getMessageSearchHealth(),
    outboxBacklog: dependencies.outboxBacklog,
    outboxBacklogError: dependencies.outboxBacklogError,
    scheduledMessages: getScheduledMessageHealth(),
    centrifugo: {
      configured: Boolean(
        env.CENTRIFUGO_API_URL &&
          env.CENTRIFUGO_API_KEY &&
          env.CENTRIFUGO_TOKEN_HMAC_SECRET,
      ),
      reachable: false,
    },
    natsDetail: natsState,
  };

  if (checks.centrifugo.configured) {
    checks.centrifugo.reachable = await isCentrifugoReachable();
  }

  const status = evaluateReadiness(checks);
  if (status === "unready") {
    return c.json({ status, timestamp: toISOString(), checks }, 503);
  }

  return c.json({ status, timestamp: toISOString(), checks });
});

/**
 * GET /health/live - Liveness probe
 * Kubernetes uses this to determine if the pod should be restarted
 */
healthRoutes.get("/live", (c) => {
  return c.json({
    status: "live",
    timestamp: toISOString(),
  });
});
