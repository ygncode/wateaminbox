/**
 * Legacy WhatsApp Routes
 *
 * Backward-compatible single connection routes.
 * These routes work with the first/only active connection for
 * clients that don't support multi-connection.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  legacyMessageSendRemoved,
  requireMessageSendPermission,
} from "../../middleware/message-send-policy.js";
import {
  requirePermission,
  tenantFromHeader,
} from "../../middleware/tenant.js";
import { PERMISSIONS } from "../../services/permission.service.js";
import * as whatsappService from "../../services/whatsapp.service.js";

const logger = createLogger("WhatsAppLegacyRoutes");

export const legacyRoutes = new Hono();

/**
 * POST /connect - Start WhatsApp connection flow (backward compatible)
 * QR codes are delivered on the authenticated company Centrifugo channel.
 */
legacyRoutes.post(
  "/connect",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");

    try {
      const result = await whatsappService.spawnConnection(
        tenantDb,
        companyId,
        user.id,
      );

      return c.json({
        success: true,
        data: {
          connectionId: result.connectionId,
          message:
            "Connection initiated. The QR code will arrive via Centrifugo.",
        },
      });
    } catch (error) {
      if (error instanceof MaxConnectionsExceededError) {
        throw new HTTPException(429, {
          message: error.message,
          cause: {
            currentCount: error.currentCount,
            maxAllowed: error.maxAllowed,
          },
        });
      }
      if (error instanceof ConnectionAlreadyExistsError) {
        throw new HTTPException(409, { message: error.message });
      }
      logger.error(
        { err: formatError(error) },
        "Failed to spawn WhatsApp connection",
      );
      throw new HTTPException(500, {
        message: "Failed to initiate WhatsApp connection",
      });
    }
  },
);

/**
 * POST /disconnect - Disconnect WhatsApp (backward compatible)
 * Disconnects the first active connection
 */
legacyRoutes.post(
  "/disconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const companyId = c.get("companyId");
    const tenantDb = c.get("tenantDb");

    try {
      // Get the first active connection for backward compatibility
      const connection = await whatsappService.getActiveConnection(tenantDb);
      if (!connection) {
        throw new ConnectionNotFoundError("active");
      }

      await whatsappService.killConnection(tenantDb, companyId, connection.id);

      return c.json({
        success: true,
        message: "WhatsApp disconnection initiated",
      });
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      logger.error(
        { err: formatError(error) },
        "Failed to disconnect WhatsApp",
      );
      throw new HTTPException(500, {
        message: "Failed to disconnect WhatsApp",
      });
    }
  },
);

/**
 * GET /status - Get WhatsApp connection status (backward compatible)
 */
legacyRoutes.get(
  "/status",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const tenantDb = c.get("tenantDb");

    try {
      const status = await whatsappService.getConnectionStatus(tenantDb);

      return c.json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "Failed to get connection status",
      );
      throw new HTTPException(500, {
        message: "Failed to get connection status",
      });
    }
  },
);

/**
 * POST /send - Send a WhatsApp message (backward compatible)
 */
legacyRoutes.post(
  "/send",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requireMessageSendPermission,
  legacyMessageSendRemoved,
);

/**
 * GET /connection - Get detailed connection info (backward compatible)
 */
legacyRoutes.get(
  "/connection",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const tenantDb = c.get("tenantDb");

    try {
      const connection = await whatsappService.getActiveConnection(tenantDb);

      if (!connection) {
        return c.json({
          success: true,
          data: null,
          message: "No active connection found",
        });
      }

      return c.json({
        success: true,
        data: {
          id: connection.id,
          phoneNumber: connection.phoneNumber,
          jid: connection.jid,
          status: connection.status,
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
        },
      });
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "Failed to get connection info",
      );
      throw new HTTPException(500, {
        message: "Failed to get connection information",
      });
    }
  },
);
