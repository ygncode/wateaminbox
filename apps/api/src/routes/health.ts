/**
 * Health Check Routes
 *
 * These endpoints use raw `c.json()` responses intentionally.
 * They are infrastructure endpoints designed for Kubernetes/Docker health probes,
 * not API endpoints. Monitoring tools expect specific simple JSON formats.
 *
 * Do NOT refactor these to use response helpers like `successData()`.
 */
import { toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { getMessageCleanupStatus } from "../services/message-cleanup.service.js";

export const healthRoutes = new Hono();

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
healthRoutes.get("/ready", (c) => {
  // Add readiness checks here (e.g., database connection)
  return c.json({
    status: "ready",
    timestamp: toISOString(),
  });
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
