/**
 * Legacy WhatsApp Routes
 *
 * Backward-compatible single connection routes.
 * These routes work with the first/only active connection for
 * clients that don't support multi-connection.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  InvalidConnectionStateError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import { authMiddleware } from "../../middleware/auth.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import { tenantFromHeader } from "../../middleware/tenant.js";
import * as whatsappService from "../../services/whatsapp.service.js";
import { sendMessageSchema } from "../../lib/schemas/index.js";

const logger = createLogger("WhatsAppLegacyRoutes");

// WhatsApp operations rate limiter: 30 requests per minute per user
const whatsappRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.messaging.whatsapp,
    keyStrategy: "user",
    keyPrefix: "whatsapp-ops",
  },
  rateLimitConfig.enabled,
);

export const legacyRoutes = new Hono();

/**
 * POST /connect - Start WhatsApp connection flow (backward compatible)
 * Returns a WebSocket URL for QR code streaming
 */
legacyRoutes.post(
  "/connect",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
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
          wsUrl: result.wsUrl,
          message:
            "Connection initiated. Connect to the WebSocket URL to receive the QR code.",
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
  tenantFromHeader("X-Company-ID", "admin"),
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
  whatsappRateLimiter,
  zValidator("json", sendMessageSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");
    const input = c.req.valid("json");

    // Validate that mediaUrl is provided for non-text messages
    if (input.messageType !== "text" && !input.mediaUrl) {
      throw new HTTPException(400, {
        message: `mediaUrl is required for ${input.messageType} messages`,
      });
    }

    try {
      const result = await whatsappService.sendMessage(
        tenantDb,
        companyId,
        user.id,
        {
          jid: input.jid,
          content: input.content,
          messageType: input.messageType,
          mediaUrl: input.mediaUrl,
        },
      );

      return c.json({
        success: true,
        data: {
          messageId: result.messageId,
          status: "pending",
          message: "Message queued for sending",
        },
      });
    } catch (error) {
      if (error instanceof InvalidConnectionStateError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      logger.error({ err: formatError(error) }, "Failed to send message");
      throw new HTTPException(500, {
        message: "Failed to send message",
      });
    }
  },
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
