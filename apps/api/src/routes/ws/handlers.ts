import {
  type ClientMessage,
  isAuthPayload,
  isSendMessagePayload,
  toISOString,
} from "@wateaminbox/shared";
import { createLogger, formatError } from "../../lib/logger.js";
import {
  publishSendMessage,
  publishTypingCommand,
} from "../../lib/nats/index.js";
import { getTenantConnection } from "../../services/tenant.service.js";
import { getActiveConnection } from "../../services/whatsapp.service.js";
import { authenticateConnection } from "./auth.js";
import { sendMessage } from "./connection.js";
import { recordPong } from "./heartbeat.js";
import type { WebSocketConnection } from "./types.js";

const logger = createLogger("WebSocket:Handlers");

/**
 * Handles the send_message client message
 */
async function handleSendMessage(
  ws: WebSocketConnection,
  payload: unknown,
): Promise<void> {
  if (!ws.data.authenticated) {
    sendMessage(ws, {
      type: "error",
      payload: { message: "Not authenticated" },
      timestamp: toISOString(),
    });
    return;
  }

  if (!isSendMessagePayload(payload)) {
    sendMessage(ws, {
      type: "error",
      payload: { message: "Missing jid or content" },
      timestamp: toISOString(),
    });
    return;
  }

  const sendPayload = payload;

  try {
    // Get an active connection to send through
    const tenantDb = getTenantConnection(ws.data.companyId);
    const connection = await getActiveConnection(tenantDb);

    if (!connection) {
      sendMessage(ws, {
        type: "error",
        payload: { message: "No active WhatsApp connection" },
        timestamp: toISOString(),
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
      timestamp: toISOString(),
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Failed to send message");
    sendMessage(ws, {
      type: "error",
      payload: { message: "Failed to send message" },
      timestamp: toISOString(),
    });
  }
}

/**
 * Handles typing indicator messages from clients
 * Forwards typing state to WhatsApp via NATS command
 */
async function handleTypingMessage(
  ws: WebSocketConnection,
  payload: unknown,
  isTyping: boolean,
): Promise<void> {
  if (!ws.data.authenticated) {
    logger.debug("Typing: connection not authenticated");
    return;
  }

  // Validate payload has conversationId
  const typingPayload = payload as { conversationId?: string };
  if (!typingPayload?.conversationId) {
    logger.debug("Typing message missing conversationId");
    return;
  }

  try {
    const tenantDb = getTenantConnection(ws.data.companyId);
    const connection = await getActiveConnection(tenantDb);

    if (!connection) {
      logger.debug(
        { companyId: ws.data.companyId },
        "Typing: no active WhatsApp connection",
      );
      return;
    }

    await publishTypingCommand(
      ws.data.companyId,
      connection.id,
      typingPayload.conversationId,
      isTyping,
    );
  } catch (error) {
    logger.error(
      { err: formatError(error) },
      "Failed to handle typing message",
    );
  }
}

/**
 * Handles client messages
 */
export async function handleClientMessage(
  ws: WebSocketConnection,
  message: string,
): Promise<void> {
  let parsed: ClientMessage;

  try {
    parsed = JSON.parse(message);
  } catch {
    sendMessage(ws, {
      type: "error",
      payload: { message: "Invalid JSON" },
      timestamp: toISOString(),
    });
    return;
  }

  switch (parsed.type) {
    case "auth": {
      if (!isAuthPayload(parsed.payload)) {
        sendMessage(ws, {
          type: "auth_error",
          payload: { message: "Missing token or companyId" },
          timestamp: toISOString(),
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
        timestamp: toISOString(),
      });
      break;

    case "send_message": {
      await handleSendMessage(ws, parsed.payload);
      break;
    }

    case "typing:start":
      await handleTypingMessage(ws, parsed.payload, true);
      break;

    case "typing:stop":
      await handleTypingMessage(ws, parsed.payload, false);
      break;

    default:
      sendMessage(ws, {
        type: "error",
        payload: { message: `Unknown message type: ${parsed.type}` },
        timestamp: toISOString(),
      });
  }
}
