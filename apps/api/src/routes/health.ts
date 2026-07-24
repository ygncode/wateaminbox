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
import { isNatsConnected } from "../lib/nats/index.js";
import {
  getCommandOutboxBacklog,
  getCommandOutboxHealth,
} from "../services/command-outbox.service.js";
import { getMessageCleanupStatus } from "../services/message-cleanup.service.js";
import { isMessageHandlerInitialized } from "../services/message-handler.js";

export const healthRoutes = new Hono();

export type ReadinessChecks = {
  postgres: boolean;
  nats: boolean;
  eventConsumer: boolean;
  pusher: { configured: boolean };
};

export function evaluateReadiness(
  checks: ReadinessChecks,
): "ready" | "degraded" | "unready" {
  if (!checks.postgres) return "unready";
  return !checks.nats || !checks.eventConsumer || !checks.pusher.configured
    ? "degraded"
    : "ready";
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
      realtime: "pusher",
    },
  });
});

/**
 * GET /health/ready - Readiness probe
 * Kubernetes uses this to determine if the pod is ready to receive traffic
 */
healthRoutes.get("/ready", async (c) => {
  const checks = {
    postgres: false,
    nats: isNatsConnected(),
    eventConsumer: isMessageHandlerInitialized(),
    outbox: getCommandOutboxHealth(),
    outboxBacklog: { pending: 0, oldestPendingAt: null as Date | null },
    pusher: {
      configured: Boolean(
        env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET,
      ),
    },
  };

  try {
    await sql`SELECT 1`.execute(db);
    checks.postgres = true;
    checks.outboxBacklog = await getCommandOutboxBacklog();
  } catch {
    // PostgreSQL is the source of truth and therefore gates readiness.
  }

  const status = evaluateReadiness(checks);
  if (status === "unready") {
    return c.json({ status, timestamp: toISOString(), checks }, 503);
  }

  // NATS, the consumer, and Pusher are reported as degraded without removing
  // the API from service; persisted REST operations remain available and the
  // command outbox recovers delivery when NATS returns.
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
