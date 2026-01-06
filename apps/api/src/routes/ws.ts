import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { verifyAccessToken } from "../lib/jwt.js";
import { createLogger, formatError } from "../lib/logger.js";
import { publishSendMessage } from "../lib/nats.js";
import { getUserById } from "../services/auth.service.js";
import { getMemberRole } from "../services/company.service.js";
import { getTenantConnection } from "../services/tenant.service.js";
import { getActiveConnection } from "../services/whatsapp.service.js";

const logger = createLogger("WebSocket");

// WebSocket data interface
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
}

// Client message types
interface ClientMessage {
  type: "auth" | "ping" | "send_message";
  payload?: unknown;
}

interface AuthPayload {
  token: string;
  companyId: string;
}

interface SendMessagePayload {
  jid: string;
  content: string;
  messageType: "text" | "image" | "video" | "audio" | "document" | "sticker";
  mediaUrl?: string;
}

// Server message types
interface ServerMessage {
  type:
    | "auth_success"
    | "auth_error"
    | "qr"
    | "connected"
    | "disconnected"
    | "message"
    | "message:new"
    | "message:status"
    | "message:deleted"
    | "message:reaction"
    | "receipt"
    | "status"
    | "contact"
    | "assignment"
    | "conversation"
    | "error"
    | "pong"
    | "send_ack"
    | "contact:profile_picture"
    | "presence:online"
    | "presence:offline"
    | "typing:start"
    | "typing:stop"
    | "notification:new";
  connectionId?: string;
  payload?: unknown;
  timestamp: string;
}

// Connection tracking
const connections = new Map<string, Set<ServerWebSocket<WSData>>>();

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

    logger.info(
      { userId: user.id, companyId },
      "Client authenticated",
    );
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
      const authPayload = parsed.payload as AuthPayload;
      if (!authPayload?.token || !authPayload?.companyId) {
        sendMessage(ws, {
          type: "auth_error",
          payload: { message: "Missing token or companyId" },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      await authenticateConnection(
        ws,
        authPayload.token,
        authPayload.companyId,
      );
      break;
    }

    case "ping":
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

      const sendPayload = parsed.payload as SendMessagePayload;
      if (!sendPayload?.jid || !sendPayload?.content) {
        sendMessage(ws, {
          type: "error",
          payload: { message: "Missing jid or content" },
          timestamp: new Date().toISOString(),
        });
        return;
      }

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
      rawWs.data = {
        userId: "",
        companyId: "",
        authenticated: false,
      };

      logger.debug("Client connected");

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
