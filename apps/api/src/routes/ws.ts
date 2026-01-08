import type { ServerWebSocket } from "bun";
import {
  type AuthPayload,
  type ClientMessage,
  type SendMessagePayload,
  type ServerMessage,
  isAuthPayload,
  isSendMessagePayload,
} from "@whatsapp-web/shared";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { verifyAccessToken } from "../lib/jwt.js";
import { createLogger, formatError } from "../lib/logger.js";
import { publishSendMessage } from "../lib/nats/index.js";
import { getUserById } from "../services/auth.service.js";
import { getMemberRole } from "../services/company.service.js";
import { getTenantConnection } from "../services/tenant.service.js";
import { getActiveConnection } from "../services/whatsapp.service.js";

const logger = createLogger("WebSocket");

// WebSocket data interface (local to this file - contains Bun-specific types)
interface WSData {
  userId: string;
  companyId: string;
  authenticated: boolean;
  events?: {
    onOpen?: unknown;
    onClose?: unknown;
    onMessage?: unknown;
    onError?: unknown;
  };
  // Heartbeat tracking
  lastPongReceived: number;
  isAlive: boolean;
}

// Heartbeat configuration
const PING_INTERVAL_MS = 45000; // Send ping every 45 seconds
const PONG_TIMEOUT_MS = 15000; // Close connection if no pong within 15 seconds

// Connection tracking
const connections = new Map<string, Set<ServerWebSocket<WSData>>>();

// Heartbeat interval reference
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Adds a WebSocket connection to the tracking map
 */
function addConnection(companyId: string, ws: ServerWebSocket<WSData>): void {
  if (!connections.has(companyId)) {
    connections.set(companyId, new Set());
  }
  connections.get(companyId)!.add(ws);
}

/**
 * Removes a WebSocket connection from the tracking map
 */
function removeConnection(
  companyId: string,
  ws: ServerWebSocket<WSData>,
): void {
  const companyConnections = connections.get(companyId);
  if (companyConnections) {
    companyConnections.delete(ws);
    if (companyConnections.size === 0) {
      connections.delete(companyId);
    }
  }
}

/**
 * Broadcasts a message to all connections for a company
 */
export function broadcastToCompany(
  companyId: string,
  message: ServerMessage,
): void {
  const companyConnections = connections.get(companyId);
  if (companyConnections) {
    const payload = JSON.stringify(message);
    let sentCount = 0;
    for (const ws of companyConnections) {
      if (ws.readyState === 1) {
        // OPEN
        ws.send(payload);
        sentCount++;
      }
    }
    if (message.type === "message:new") {
      logger.debug(
        { sentCount, companyId },
        "Broadcast message:new to clients",
      );
    }
    if (
      message.type === "media:downloaded" ||
      message.type === "media:download_failed"
    ) {
      logger.info(
        { sentCount, companyId, type: message.type, payload: message.payload },
        "Broadcast media event to clients",
      );
    }
  } else {
    if (message.type === "message:new") {
      logger.debug(
        { companyId },
        "No active connections for company to broadcast message",
      );
    }
  }
}

/**
 * Sends a message to a specific WebSocket
 */
function sendMessage(
  ws: ServerWebSocket<WSData>,
  message: ServerMessage,
): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Sends a ping to a specific WebSocket for heartbeat
 */
function sendPing(ws: ServerWebSocket<WSData>): void {
  if (ws.readyState === 1) {
    // Use WebSocket protocol-level ping if available, otherwise send a custom ping message
    try {
      ws.ping();
    } catch {
      // Fallback to application-level ping if protocol ping fails
      sendMessage(ws, {
        type: "pong", // Server sends "pong" as a ping request (client should respond with "ping")
        timestamp: new Date().toISOString(),
      });
    }
  }
}

/**
 * Starts the server-side heartbeat interval
 * Periodically pings all connections and closes stale ones
 */
function startHeartbeat(): void {
  if (heartbeatIntervalId) {
    return; // Already running
  }

  logger.info("Starting server-side heartbeat");

  heartbeatIntervalId = setInterval(() => {
    const now = Date.now();
    let pingsSent = 0;
    let staleConnections = 0;

    for (const [companyId, companyConnections] of connections) {
      for (const ws of companyConnections) {
        // Check if this connection has timed out
        if (!ws.data.isAlive && now - ws.data.lastPongReceived > PONG_TIMEOUT_MS) {
          // Connection is stale - close it
          logger.warn(
            { companyId, userId: ws.data.userId },
            "Closing stale connection - no heartbeat response",
          );
          staleConnections++;
          try {
            ws.close(1001, "Connection timed out - no heartbeat response");
          } catch {
            // Ignore close errors
          }
          removeConnection(companyId, ws);
          continue;
        }

        // Mark as not alive and send ping
        // Will be marked alive again when pong is received
        ws.data.isAlive = false;
        sendPing(ws);
        pingsSent++;
      }
    }

    if (pingsSent > 0 || staleConnections > 0) {
      logger.debug(
        { pingsSent, staleConnections },
        "Heartbeat cycle completed",
      );
    }
  }, PING_INTERVAL_MS);
}

/**
 * Stops the server-side heartbeat interval
 */
function stopHeartbeat(): void {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    logger.info("Stopped server-side heartbeat");
  }
}

/**
 * Records a pong response from a client
 */
function recordPong(ws: ServerWebSocket<WSData>): void {
  ws.data.isAlive = true;
  ws.data.lastPongReceived = Date.now();
}

/**
 * Authenticates a WebSocket connection
 */
async function authenticateConnection(
  ws: ServerWebSocket<WSData>,
  token: string,
  companyId: string,
): Promise<boolean> {
  try {
    // Validate UUID format for company ID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(companyId)) {
      sendMessage(ws, {
        type: "auth_error",
        payload: { message: "Invalid company ID format" },
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // Verify JWT token
    const payload = await verifyAccessToken(token);
    if (!payload) {
      sendMessage(ws, {
        type: "auth_error",
        payload: { message: "Invalid or expired token" },
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // Verify user exists
    const user = await getUserById(payload.userId);
    if (!user) {
      sendMessage(ws, {
        type: "auth_error",
        payload: { message: "User not found" },
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // Verify user is member of company
    const role = await getMemberRole(companyId, user.id);
    if (!role) {
      sendMessage(ws, {
        type: "auth_error",
        payload: { message: "You are not a member of this company" },
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // Update WebSocket data
    ws.data.userId = user.id;
    ws.data.companyId = companyId;
    ws.data.authenticated = true;

    // Add to company connections
    addConnection(companyId, ws);

    sendMessage(ws, {
      type: "auth_success",
      payload: {
        userId: user.id,
        companyId,
        message: "Successfully authenticated",
      },
      timestamp: new Date().toISOString(),
    });

    logger.info({ userId: user.id, companyId }, "Client authenticated");
    return true;
  } catch (error) {
    logger.error({ err: formatError(error) }, "Authentication error");
    sendMessage(ws, {
      type: "auth_error",
      payload: { message: "Authentication failed" },
      timestamp: new Date().toISOString(),
    });
    return false;
  }
}

/**
 * Handles client messages
 */
async function handleClientMessage(
  ws: ServerWebSocket<WSData>,
  message: string,
): Promise<void> {
  let parsed: ClientMessage;

  try {
    parsed = JSON.parse(message);
  } catch {
    sendMessage(ws, {
      type: "error",
      payload: { message: "Invalid JSON" },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  switch (parsed.type) {
    case "auth": {
      if (!isAuthPayload(parsed.payload)) {
        sendMessage(ws, {
          type: "auth_error",
          payload: { message: "Missing token or companyId" },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      await authenticateConnection(
        ws,
        parsed.payload.token,
        parsed.payload.companyId,
      );
      break;
    }

    case "ping":
      // Client is alive - record the activity and respond with pong
      recordPong(ws);
      sendMessage(ws, {
        type: "pong",
        timestamp: new Date().toISOString(),
      });
      break;

    case "send_message": {
      if (!ws.data.authenticated) {
        sendMessage(ws, {
          type: "error",
          payload: { message: "Not authenticated" },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!isSendMessagePayload(parsed.payload)) {
        sendMessage(ws, {
          type: "error",
          payload: { message: "Missing jid or content" },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const sendPayload = parsed.payload;

      try {
        // Get an active connection to send through
        const tenantDb = getTenantConnection(ws.data.companyId);
        const connection = await getActiveConnection(tenantDb);

        if (!connection) {
          sendMessage(ws, {
            type: "error",
            payload: { message: "No active WhatsApp connection" },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Generate a pending message ID for this WebSocket-initiated message
        const pendingMessageId = crypto.randomUUID();

        await publishSendMessage(
          ws.data.companyId,
          connection.id,
          sendPayload.jid,
          sendPayload.content,
          sendPayload.messageType || "text",
          ws.data.userId,
          pendingMessageId,
          sendPayload.mediaUrl,
        );

        sendMessage(ws, {
          type: "send_ack",
          payload: {
            jid: sendPayload.jid,
            connectionId: connection.id,
            status: "queued",
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: formatError(error) }, "Failed to send message");
        sendMessage(ws, {
          type: "error",
          payload: { message: "Failed to send message" },
          timestamp: new Date().toISOString(),
        });
      }
      break;
    }

    default:
      sendMessage(ws, {
        type: "error",
        payload: { message: `Unknown message type: ${parsed.type}` },
        timestamp: new Date().toISOString(),
      });
  }
}

// Create Bun WebSocket handler
const { upgradeWebSocket, websocket: honoWebsocket } =
  createBunWebSocket<WSData>();

// Wrap the websocket handler with null checks to prevent crashes
export const websocket: typeof honoWebsocket = {
  ...honoWebsocket,
  close(
    ws: Parameters<typeof honoWebsocket.close>[0],
    code?: number,
    reason?: string,
  ) {
    // Guard against undefined data.events (happens when connection closes before full setup)
    if (ws.data?.events?.onClose) {
      honoWebsocket.close(ws, code, reason);
    } else {
      logger.debug("Connection closed before initialization");
    }
  },
  message(
    ws: Parameters<typeof honoWebsocket.message>[0],
    message: string | Buffer,
  ) {
    // Guard against undefined data.events
    if (ws.data?.events?.onMessage) {
      honoWebsocket.message(ws, message);
    } else {
      logger.debug("Message received before initialization");
    }
  },
};

// WebSocket route
export const wsRoutes = new Hono();

const wsUpgradeHandler = upgradeWebSocket((c) => {
  // Extract token and company from query params for initial auth
  const token = c.req.query("token");
  const company = c.req.query("company");

  return {
    onOpen: async (_event, ws) => {
      const rawWs = ws.raw as unknown as ServerWebSocket<WSData>;
      const now = Date.now();
      rawWs.data = {
        userId: "",
        companyId: "",
        authenticated: false,
        lastPongReceived: now,
        isAlive: true,
      };

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
          timestamp: new Date().toISOString(),
        });
      }
    },

    onMessage: async (event, ws) => {
      const rawWs = ws.raw as unknown as ServerWebSocket<WSData>;
      const message =
        typeof event.data === "string" ? event.data : event.data.toString();

      await handleClientMessage(rawWs, message);
    },

    onClose: (_event, ws) => {
      const rawWs = ws.raw as unknown as ServerWebSocket<WSData>;
      logger.debug("Client disconnected");

      // Remove from connections
      if (rawWs.data.companyId) {
        removeConnection(rawWs.data.companyId, rawWs);
      }
    },

    onError: (error, ws) => {
      logger.error({ err: formatError(error) }, "WebSocket error");
      const rawWs = ws.raw as unknown as ServerWebSocket<WSData>;

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
 * Gets the number of active connections for a company
 */
export function getConnectionCount(companyId: string): number {
  return connections.get(companyId)?.size || 0;
}

/**
 * Gets total number of active WebSocket connections
 */
export function getTotalConnectionCount(): number {
  let total = 0;
  for (const conns of connections.values()) {
    total += conns.size;
  }
  return total;
}

/**
 * Gracefully shuts down the WebSocket heartbeat
 * Should be called during server shutdown
 */
export function shutdownHeartbeat(): void {
  stopHeartbeat();
}

/**
 * Checks if the heartbeat is currently running
 */
export function isHeartbeatRunning(): boolean {
  return heartbeatIntervalId !== null;
}

/**
 * Gets detailed connection metrics
 */
export function getConnectionMetrics(): {
  totalConnections: number;
  companiesConnected: number;
  connectionsPerCompany: { companyId: string; connections: number }[];
  heartbeatRunning: boolean;
} {
  const connectionsPerCompany: { companyId: string; connections: number }[] =
    [];
  let totalConnections = 0;

  for (const [companyId, conns] of connections) {
    const count = conns.size;
    totalConnections += count;
    connectionsPerCompany.push({ companyId, connections: count });
  }

  return {
    totalConnections,
    companiesConnected: connections.size,
    connectionsPerCompany,
    heartbeatRunning: heartbeatIntervalId !== null,
  };
}
