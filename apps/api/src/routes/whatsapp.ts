import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth.js";
import { tenantFromHeader } from "../middleware/tenant.js";
import * as whatsappService from "../services/whatsapp.service.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";

// Validation schemas
const sendMessageSchema = z.object({
  jid: z
    .string()
    .min(1, "JID is required")
    .regex(
      /^[0-9]+@(s\.whatsapp\.net|g\.us)$/,
      "Invalid JID format. Expected format: number@s.whatsapp.net or groupid@g.us",
    ),
  content: z.string().min(1, "Message content is required"),
  messageType: z
    .enum(["text", "image", "video", "audio", "document", "sticker"])
    .default("text"),
  mediaUrl: z.string().url().optional(),
});

// WhatsApp operations rate limiter: 30 requests per minute per user
// Prevents abuse of WhatsApp connection and send operations
const whatsappRateLimiter = createRateLimitMiddleware({
  store: rateLimitStore,
  tier: rateLimitConfig.tiers.messaging.whatsapp,
  keyStrategy: "user",
  keyPrefix: "whatsapp-ops",
});

// Create the router
export const whatsappRoutes = new Hono();

// ============================================================================
// BACKWARD COMPATIBLE ROUTES (single connection)
// ============================================================================

/**
 * POST /whatsapp/connect - Start WhatsApp connection flow (backward compatible)
 * Returns a WebSocket URL for QR code streaming
 */
whatsappRoutes.post(
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
      const err = error as Error & {
        code?: string;
        currentCount?: number;
        maxAllowed?: number;
      };
      // Check by code property, name, instanceof, or message pattern (fallback)
      const isMaxConnectionsError =
        err.code === "MAX_CONNECTIONS_EXCEEDED" ||
        err.name === "MaxConnectionsExceededError" ||
        error instanceof whatsappService.MaxConnectionsExceededError ||
        err.message?.includes("Maximum WhatsApp connections exceeded");

      if (isMaxConnectionsError) {
        throw new HTTPException(429, {
          message: err.message,
          cause: {
            currentCount: err.currentCount,
            maxAllowed: err.maxAllowed,
          },
        });
      }
      if (
        err.name === "ConnectionAlreadyExistsError" ||
        error instanceof whatsappService.ConnectionAlreadyExistsError
      ) {
        throw new HTTPException(409, { message: err.message });
      }
      console.error("Failed to spawn WhatsApp connection:", error);
      throw new HTTPException(500, {
        message: "Failed to initiate WhatsApp connection",
      });
    }
  },
);

/**
 * POST /whatsapp/disconnect - Disconnect WhatsApp (backward compatible)
 * Disconnects the first active connection
 */
whatsappRoutes.post(
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
        throw new whatsappService.ConnectionNotFoundError("active");
      }

      await whatsappService.killConnection(tenantDb, companyId, connection.id);

      return c.json({
        success: true,
        message: "WhatsApp disconnection initiated",
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to disconnect WhatsApp:", error);
      throw new HTTPException(500, {
        message: "Failed to disconnect WhatsApp",
      });
    }
  },
);

/**
 * GET /whatsapp/status - Get WhatsApp connection status (backward compatible)
 */
whatsappRoutes.get(
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
      console.error("Failed to get connection status:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection status",
      });
    }
  },
);

/**
 * POST /whatsapp/send - Send a WhatsApp message (backward compatible)
 */
whatsappRoutes.post(
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
      if (error instanceof whatsappService.InvalidConnectionStateError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to send message:", error);
      throw new HTTPException(500, {
        message: "Failed to send message",
      });
    }
  },
);

/**
 * GET /whatsapp/connection - Get detailed connection info (backward compatible)
 */
whatsappRoutes.get(
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
      console.error("Failed to get connection info:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection information",
      });
    }
  },
);

// ============================================================================
// MULTI-CONNECTION ROUTES
// ============================================================================

/**
 * GET /whatsapp/connections - List all WhatsApp connections
 */
whatsappRoutes.get(
  "/connections",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const companyId = c.get("companyId");
    const tenantDb = c.get("tenantDb");

    try {
      const connections = await whatsappService.listConnections(tenantDb);
      const limits = await whatsappService.getConnectionLimits(
        tenantDb,
        companyId,
      );

      return c.json({
        success: true,
        data: connections.map((conn, index) => ({
          id: conn.id,
          name: conn.name || conn.phoneNumber || `Connection ${index + 1}`,
          phoneNumber: conn.phoneNumber,
          jid: conn.jid,
          status: conn.status,
          connectedBy: conn.connectedBy,
          connectedAt: conn.connectedAt,
          lastSync: conn.lastSyncAt,
          createdAt: conn.createdAt,
          updatedAt: conn.updatedAt,
        })),
        meta: {
          total: connections.length,
          limits,
        },
      });
    } catch (error) {
      console.error("Failed to list connections:", error);
      throw new HTTPException(500, {
        message: "Failed to list WhatsApp connections",
      });
    }
  },
);

/**
 * POST /whatsapp/connections - Create a new WhatsApp connection
 */
whatsappRoutes.post(
  "/connections",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");

    try {
      // Read name from request body
      const body = await c.req.json().catch(() => ({}));
      const name = body.name as string | undefined;

      const result = await whatsappService.spawnConnection(
        tenantDb,
        companyId,
        user.id,
        name,
      );

      return c.json(
        {
          success: true,
          data: {
            id: result.connectionId,
            name: name || null,
            status: "pending" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          message:
            "Connection initiated. Connect to the WebSocket URL to receive the QR code.",
          websocketUrl: result.wsUrl,
        },
        201,
      );
    } catch (error) {
      const err = error as Error & {
        code?: string;
        currentCount?: number;
        maxAllowed?: number;
      };

      // Check by code property, name, instanceof, or message pattern (fallback)
      const isMaxConnectionsError =
        err.code === "MAX_CONNECTIONS_EXCEEDED" ||
        err.name === "MaxConnectionsExceededError" ||
        error instanceof whatsappService.MaxConnectionsExceededError ||
        err.message?.includes("Maximum WhatsApp connections exceeded");

      if (isMaxConnectionsError) {
        throw new HTTPException(429, {
          message: err.message,
          cause: {
            currentCount: err.currentCount,
            maxAllowed: err.maxAllowed,
          },
        });
      }
      console.error("Failed to create WhatsApp connection:", error);
      throw new HTTPException(500, {
        message: "Failed to create WhatsApp connection",
      });
    }
  },
);

/**
 * GET /whatsapp/connections/:connectionId - Get specific connection details
 */
whatsappRoutes.get(
  "/connections/:connectionId",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      const connection = await whatsappService.getConnection(
        tenantDb,
        connectionId,
      );

      return c.json({
        success: true,
        data: {
          id: connection.id,
          phoneNumber: connection.phoneNumber,
          jid: connection.jid,
          status: connection.status,
          connectedBy: connection.connectedBy,
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to get connection:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection details",
      });
    }
  },
);

/**
 * PATCH /whatsapp/connections/:connectionId - Update connection (e.g., rename)
 * Note: Currently name is auto-generated from phone number, so this is a no-op
 * but returns success for frontend compatibility
 */
whatsappRoutes.patch(
  "/connections/:connectionId",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      // Verify connection exists
      const connection = await whatsappService.getConnection(
        tenantDb,
        connectionId,
      );

      // Note: Name is auto-generated from phone number, not stored separately
      // Return the connection as-is for frontend compatibility
      return c.json({
        success: true,
        data: {
          id: connection.id,
          name: connection.phoneNumber || `Connection`,
          phoneNumber: connection.phoneNumber,
          jid: connection.jid,
          status: connection.status,
          connectedAt: connection.connectedAt,
          lastSync: connection.lastSyncAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to update connection:", error);
      throw new HTTPException(500, {
        message: "Failed to update connection",
      });
    }
  },
);

/**
 * DELETE /whatsapp/connections/:connectionId - Delete a connection permanently
 */
whatsappRoutes.delete(
  "/connections/:connectionId",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      // First disconnect if connected
      const connection = await whatsappService.getConnection(
        tenantDb,
        connectionId,
      );

      if (
        connection.status === "connected" ||
        connection.status === "pending"
      ) {
        await whatsappService.killConnection(tenantDb, companyId, connectionId);
      }

      // Delete from database
      await tenantDb
        .deleteFrom("whatsapp_connections")
        .where("id", "=", connectionId)
        .execute();

      return c.json({
        success: true,
        message: "Connection deleted successfully",
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to delete connection:", error);
      throw new HTTPException(500, {
        message: "Failed to delete connection",
      });
    }
  },
);

/**
 * POST /whatsapp/connections/:connectionId/reconnect - Reconnect a disconnected connection
 */
whatsappRoutes.post(
  "/connections/:connectionId/reconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      // Verify connection exists
      const connection = await whatsappService.getConnection(
        tenantDb,
        connectionId,
      );

      // Only allow reconnect for disconnected connections
      if (connection.status === "connected") {
        throw new HTTPException(400, {
          message: "Connection is already connected",
        });
      }

      if (connection.status === "pending") {
        throw new HTTPException(400, {
          message: "Connection is already pending",
        });
      }

      // Update status to pending
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          status: "pending",
          updated_at: new Date(),
        })
        .where("id", "=", connectionId)
        .execute();

      // Publish spawn command to NATS
      const { publishSpawnCommand } = await import("../lib/nats.js");
      const { env } = await import("../lib/env.js");
      await publishSpawnCommand(companyId, connectionId, env.DATABASE_URL);

      return c.json({
        success: true,
        message: "Reconnection initiated",
        websocketUrl: `/ws?company=${companyId}&connection=${connectionId}`,
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error("Failed to reconnect:", error);
      throw new HTTPException(500, {
        message: "Failed to reconnect",
      });
    }
  },
);

/**
 * POST /whatsapp/connections/:connectionId/disconnect - Disconnect specific connection
 */
whatsappRoutes.post(
  "/connections/:connectionId/disconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      await whatsappService.killConnection(tenantDb, companyId, connectionId);

      return c.json({
        success: true,
        message: "WhatsApp disconnection initiated",
        data: {
          connectionId,
        },
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to disconnect WhatsApp:", error);
      throw new HTTPException(500, {
        message: "Failed to disconnect WhatsApp",
      });
    }
  },
);

/**
 * POST /whatsapp/connections/:connectionId/send - Send message via specific connection
 */
whatsappRoutes.post(
  "/connections/:connectionId/send",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  whatsappRateLimiter,
  zValidator("json", sendMessageSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId");
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
        connectionId,
      );

      return c.json({
        success: true,
        data: {
          messageId: result.messageId,
          connectionId,
          status: "pending",
          message: "Message queued for sending",
        },
      });
    } catch (error) {
      if (error instanceof whatsappService.InvalidConnectionStateError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to send message:", error);
      throw new HTTPException(500, {
        message: "Failed to send message",
      });
    }
  },
);

/**
 * GET /whatsapp/connections/:connectionId/status - Get specific connection status
 */
whatsappRoutes.get(
  "/connections/:connectionId/status",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      const status = await whatsappService.getConnectionStatus(
        tenantDb,
        connectionId,
      );

      return c.json({
        success: true,
        data: {
          connectionId,
          ...status,
        },
      });
    } catch (error) {
      console.error("Failed to get connection status:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection status",
      });
    }
  },
);

/**
 * GET /whatsapp/limits - Get connection limits for the company
 */
whatsappRoutes.get(
  "/limits",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const companyId = c.get("companyId");
    const tenantDb = c.get("tenantDb");

    try {
      const limits = await whatsappService.getConnectionLimits(
        tenantDb,
        companyId,
      );

      return c.json({
        success: true,
        data: limits,
      });
    } catch (error) {
      console.error("Failed to get connection limits:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection limits",
      });
    }
  },
);
