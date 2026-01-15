import { verifyAccessToken } from "../../lib/jwt.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { getUserById } from "../../services/auth.service.js";
import { getMemberRole } from "../../services/company.service.js";
import { addConnection, sendMessage } from "./connection.js";
import type { WebSocketConnection } from "./types.js";

const logger = createLogger("WebSocket:Auth");

/**
 * Authenticates a WebSocket connection
 */
export async function authenticateConnection(
  ws: WebSocketConnection,
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
