/**
 * WhatsApp Multi-Connection Routes
 *
 * CRUD operations for managing multiple WhatsApp connections per company.
 */
import { zValidator } from "@hono/zod-validator";
import { toDbDate, toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  ConnectionNotFoundError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  legacyMessageSendRemoved,
  requireMessageSendPermission,
} from "../../middleware/message-send-policy.js";
import { tenantFromHeader } from "../../middleware/tenant.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import * as whatsappService from "../../services/whatsapp.service.js";
import { deleteConnectionWithKill } from "../../services/whatsapp/connection.js";

const connectionNameSchema = z.string().trim().min(1).max(80);
const createConnectionSchema = z.object({
  name: connectionNameSchema.optional(),
});
const updateConnectionSchema = z.object({
  name: connectionNameSchema,
});

const logger = createLogger("WhatsAppConnectionRoutes");

export const connectionRoutes = new Hono();

/**
 * GET /connections - List all WhatsApp connections
 */
connectionRoutes.get(
  "/",
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
          qrCode: conn.qrCode,
          qrExpiresAt: conn.qrExpiresAt,
        })),
        meta: {
          total: connections.length,
          limits,
        },
      });
    } catch (error) {
      logger.error({ err: formatError(error) }, "Failed to list connections");
      throw new HTTPException(500, {
        message: "Failed to list WhatsApp connections",
      });
    }
  },
);

/**
 * POST /connections - Create a new WhatsApp connection
 */
connectionRoutes.post(
  "/",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  zValidator("json", createConnectionSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");

    try {
      const { name } = c.req.valid("json");

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
            createdAt: toISOString(),
            updatedAt: toISOString(),
          },
          message: "Connection initiated. The QR code will arrive via Pusher.",
        },
        201,
      );
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
      logger.error(
        { err: formatError(error) },
        "Failed to create WhatsApp connection",
      );
      throw new HTTPException(500, {
        message: "Failed to create WhatsApp connection",
      });
    }
  },
);

/**
 * GET /connections/:connectionId - Get specific connection details
 */
connectionRoutes.get(
  "/:connectionId",
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
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      logger.error({ err: formatError(error) }, "Failed to get connection");
      throw new HTTPException(500, {
        message: "Failed to get connection details",
      });
    }
  },
);

/**
 * PATCH /connections/:connectionId - Update connection (e.g., rename)
 */
connectionRoutes.patch(
  "/:connectionId",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  zValidator("json", updateConnectionSchema),
  async (c) => {
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");
    const { name } = c.req.valid("json");

    try {
      await whatsappService.getConnection(tenantDb, connectionId);
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({ name, updated_at: toDbDate() })
        .where("id", "=", connectionId)
        .execute();
      const connection = await whatsappService.getConnection(
        tenantDb,
        connectionId,
      );

      return c.json({
        success: true,
        data: {
          id: connection.id,
          name: connection.name,
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
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      logger.error({ err: formatError(error) }, "Failed to update connection");
      throw new HTTPException(500, {
        message: "Failed to update connection",
      });
    }
  },
);

/**
 * DELETE /connections/:connectionId - Delete a connection permanently
 */
connectionRoutes.delete(
  "/:connectionId",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId");
    const tenantDb = c.get("tenantDb");

    try {
      // The kill intent and row deletion commit together. JetStream receives
      // an idempotent kill command from the durable outbox after commit.
      const deleted = await tenantDb
        .transaction()
        .execute((trx) =>
          deleteConnectionWithKill(
            trx,
            companyId,
            connectionId,
          ),
        );

      return c.json({
        success: true,
        message: deleted
          ? "Connection deletion queued"
          : "Connection was already deleted",
      });
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      logger.error({ err: formatError(error) }, "Failed to delete connection");
      throw new HTTPException(500, {
        message: "Failed to delete connection",
      });
    }
  },
);

/**
 * POST /connections/:connectionId/reconnect - Reconnect a disconnected connection
 */
connectionRoutes.post(
  "/:connectionId/reconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
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

      // A pending worker owns a QR session that must be replaced before a new
      // pairing attempt. A disconnected connection has no active worker;
      // killConnection intentionally rejects it, so do not turn a valid retry
      // into a misleading "connection not found" error.
      if (connection.status === "pending") {
        await whatsappService.killConnection(tenantDb, companyId, connectionId);
      }

      await tenantDb.transaction().execute(async (trx) => {
        await trx
          .updateTable("whatsapp_connections")
          .set({
            status: "pending",
            qr_code: null,
            qr_expires_at: null,
            updated_at: toDbDate(),
          })
          .where("id", "=", connectionId)
          .execute();
        await enqueueConnectionCommand(
          trx,
          companyId,
          connectionId,
          (publisher) => publisher.spawn(),
        );
      });

      return c.json({
        success: true,
        message: "Reconnection initiated",
      });
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof HTTPException) {
        throw error;
      }
      logger.error({ err: formatError(error) }, "Failed to reconnect");
      throw new HTTPException(500, {
        message: "Failed to reconnect",
      });
    }
  },
);

/**
 * POST /connections/:connectionId/disconnect - Disconnect specific connection
 */
connectionRoutes.post(
  "/:connectionId/disconnect",
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
 * POST /connections/:connectionId/send - Send message via specific connection
 */
connectionRoutes.post(
  "/:connectionId/send",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requireMessageSendPermission,
  legacyMessageSendRemoved,
);

/**
 * GET /connections/:connectionId/status - Get specific connection status
 */
connectionRoutes.get(
  "/:connectionId/status",
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
