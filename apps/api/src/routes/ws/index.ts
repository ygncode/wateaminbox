import { toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { createLogger, formatError } from "../../lib/logger.js";
import { authenticateConnection } from "./auth.js";
import {
  broadcastToCompany,
  getConnectionCount,
  getConnectionMetrics as getConnectionMetricsInternal,
  getTotalConnectionCount,
  removeConnection,
  sendMessage,
} from "./connection.js";
import { handleClientMessage } from "./handlers.js";
import {
  isHeartbeatRunning,
  shutdownHeartbeat,
  startHeartbeat,
} from "./heartbeat.js";
import type { WSData, WebSocketConnection } from "./types.js";

const logger = createLogger("WebSocket");

// Create Bun WebSocket handler
const { upgradeWebSocket, websocket: honoWebsocket } =
  createBunWebSocket<WSData>();

// Use the Hono websocket handler directly
// Previous wrapper was checking for ws.data.events which doesn't exist,
// causing all messages to be dropped
export const websocket = honoWebsocket;

// WebSocket route
export const wsRoutes = new Hono();

const wsUpgradeHandler = upgradeWebSocket((c) => {
  // Extract token and company from query params for initial auth
  const token = c.req.query("token");
  const company = c.req.query("company");

  return {
    onOpen: async (_event, ws) => {
      const rawWs = ws.raw as unknown as WebSocketConnection;
      const now = Date.now();
      // Modify existing ws.data object in-place to preserve Hono's internal references
      // Don't replace the object - just add our properties to it
      if (rawWs.data) {
        rawWs.data.userId = "";
        rawWs.data.companyId = "";
        rawWs.data.authenticated = false;
        rawWs.data.lastPongReceived = now;
        rawWs.data.isAlive = true;
      } else {
        rawWs.data = {
          userId: "",
          companyId: "",
          authenticated: false,
          lastPongReceived: now,
          isAlive: true,
        };
      }

      logger.debug("Client connected");

      // Start heartbeat if not already running
      startHeartbeat();

      // If token and company provided in query, auto-authenticate
      if (token && company) {
        await authenticateConnection(rawWs, token, company);
      } else {
        // Send auth required message
        sendMessage(rawWs, {
          type: "error",
          payload: {
            message:
              "Authentication required. Send auth message with token and companyId.",
          },
          timestamp: toISOString(),
        });
      }
    },

    onMessage: async (event, ws) => {
      const rawWs = ws.raw as unknown as WebSocketConnection;
      const message =
        typeof event.data === "string" ? event.data : event.data.toString();

      await handleClientMessage(rawWs, message);
    },

    onClose: (_event, ws) => {
      const rawWs = ws.raw as unknown as WebSocketConnection;
      logger.debug("Client disconnected");

      // Remove from connections
      if (rawWs.data.companyId) {
        removeConnection(rawWs.data.companyId, rawWs);
      }
    },

    onError: (error, ws) => {
      logger.error({ err: formatError(error) }, "WebSocket error");
      const rawWs = ws.raw as unknown as WebSocketConnection;

      // Remove from connections
      if (rawWs.data.companyId) {
        removeConnection(rawWs.data.companyId, rawWs);
      }
    },
  };
});

// Support both with and without trailing slash to match ws://localhost:3001/api/ws
wsRoutes.get("/", wsUpgradeHandler);
wsRoutes.get("", wsUpgradeHandler);

/**
 * Gets detailed connection metrics
 */
export function getConnectionMetrics(): ReturnType<
  typeof getConnectionMetricsInternal
> {
  return getConnectionMetricsInternal(isHeartbeatRunning());
}

// Re-export functions that may be used externally
export {
  broadcastToCompany,
  getConnectionCount,
  getTotalConnectionCount,
  isHeartbeatRunning,
  shutdownHeartbeat,
};
export type { WSData, WebSocketConnection };
