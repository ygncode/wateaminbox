import { Hono } from "hono";
import { getMessageCleanupStatus } from "../services/message-cleanup.service.js";
import {
  getTotalConnectionCount,
  isHeartbeatRunning,
  getConnectionMetrics,
} from "./ws/index.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      messageCleanup: getMessageCleanupStatus(),
      websocket: {
        totalConnections: getTotalConnectionCount(),
        heartbeatRunning: isHeartbeatRunning(),
      },
    },
  });
});

healthRoutes.get("/ready", (c) => {
  // Add readiness checks here (e.g., database connection)
  return c.json({
    status: "ready",
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/live", (c) => {
  return c.json({
    status: "live",
    timestamp: new Date().toISOString(),
  });
});

// Detailed WebSocket metrics endpoint
healthRoutes.get("/ws-metrics", (c) => {
  return c.json({
    timestamp: new Date().toISOString(),
    ...getConnectionMetrics(),
  });
});
