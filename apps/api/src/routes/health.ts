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
import { isCentrifugoReachable } from "../lib/realtime.js";
import {
  getCommandOutboxBacklog,
  getCommandOutboxHealth,
} from "../services/command-outbox.service.js";
import { getMessageCleanupStatus } from "../services/message-cleanup.service.js";
import { getScheduledMessageHealth } from "../services/scheduled-message.service.js";

export const healthRoutes = new Hono();

export type ReadinessChecks = {
  postgres: boolean;
  nats: boolean;
  eventConsumer: boolean;
  centrifugo: { configured: boolean; reachable: boolean };
};

export function evaluateReadiness(
  checks: ReadinessChecks,
): "ready" | "degraded" | "unready" {
  if (!checks.postgres) return "unready";
  if (!checks.nats || !checks.eventConsumer) return "unready";
  return !checks.centrifugo.configured || !checks.centrifugo.reachable
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
  const checks = {
    postgres: false,
    nats: natsState.nats.connected,
    eventConsumer: natsState.eventConsumer.active,
    outbox: getCommandOutboxHealth(),
    outboxBacklog: { pending: 0, oldestPendingAt: null as Date | null },
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

  try {
    await sql`SELECT 1`.execute(db);
    checks.postgres = true;
    checks.outboxBacklog = await getCommandOutboxBacklog();
  } catch {
    // PostgreSQL is the source of truth and therefore gates readiness.
  }

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
