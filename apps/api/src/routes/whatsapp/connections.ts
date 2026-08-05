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
import {
  requirePermission,
  tenantFromHeader,
} from "../../middleware/tenant.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import {
  deleteContacts,
  deleteMessages,
} from "../../services/meilisearch.service.js";
import { PERMISSIONS } from "../../services/permission.service.js";
import { archiveConnectionWithUnlink } from "../../services/whatsapp/connection.js";
import { updateSessionStatus } from "../../services/whatsapp/session.js";
import * as whatsappService from "../../services/whatsapp.service.js";

const connectionNameSchema = z.string().trim().min(1).max(80);
const createConnectionSchema = z.object({
  name: connectionNameSchema.optional(),
});
const updateConnectionSchema = z.object({
  name: connectionNameSchema,
});
const purgeConnectionSchema = z.object({
  confirmation: z.literal("DELETE"),
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
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
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
          message:
            "Connection initiated. The QR code will arrive via Centrifugo.",
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

connectionRoutes.get(
  "/archived",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const connections = await whatsappService.listArchivedConnections(
      c.get("tenantDb"),
    );
    return c.json({
      success: true,
      data: connections.map((connection, index) => ({
        id: connection.id,
        name:
          connection.name ||
          connection.phoneNumber ||
          `Archived connection ${index + 1}`,
        phoneNumber: connection.phoneNumber,
        jid: connection.jid,
        status: connection.status,
        archivedAt: connection.archivedAt,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      })),
    });
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
    const connectionId = c.req.param("connectionId")!;
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
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  zValidator("json", updateConnectionSchema),
  async (c) => {
    const connectionId = c.req.param("connectionId")!;
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
 * DELETE /connections/:connectionId - Archive the stable account and unlink
 * its current WhatsApp session. Historical inbox data is retained.
 */
connectionRoutes.delete(
  "/:connectionId",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId")!;
    const tenantDb = c.get("tenantDb");

    try {
      // The archived state, ended session, and unlink intent commit together.
      // JetStream receives the idempotent command after commit.
      const deleted = await tenantDb
        .transaction()
        .execute((trx) =>
          archiveConnectionWithUnlink(trx, companyId, connectionId),
        );
      if (deleted) {
        await createAuditLog({
          companyId,
          userId: c.get("user").id,
          action: "connection.archived",
          entityType: "whatsapp_connection",
          entityId: connectionId,
          ipAddress: getClientIp(c),
        });
      }

      return c.json({
        success: true,
        message: deleted
          ? "Connection archive and unlink queued"
          : "Connection was already archived",
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
 * POST /connections/:connectionId/purge - Permanently erase an archived
 * account and all of its inbox data.
 */
connectionRoutes.post(
  "/:connectionId/purge",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  requirePermission(PERMISSIONS.CAN_DELETE),
  zValidator("json", purgeConnectionSchema),
  async (c) => {
    const connectionId = c.req.param("connectionId")!;
    const tenantDb = c.get("tenantDb");
    const deleted = await whatsappService.purgeArchivedConnection(
      tenantDb,
      connectionId,
    );
    await Promise.all([
      deleteContacts(c.get("companyId"), deleted.contactIds),
      deleteMessages(c.get("companyId"), deleted.messageIds),
    ]);
    await createAuditLog({
      companyId: c.get("companyId"),
      userId: c.get("user").id,
      action: "connection.purged",
      entityType: "whatsapp_connection",
      entityId: connectionId,
      details: {
        deletedContacts: deleted.contactIds.length,
        deletedMessages: deleted.messageIds.length,
      },
      ipAddress: getClientIp(c),
    });
    return c.json({
      success: true,
      message: "Connection and inbox data permanently deleted",
    });
  },
);

/**
 * POST /connections/:connectionId/reconnect - Reconnect a disconnected connection
 */
connectionRoutes.post(
  "/:connectionId/reconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId")!;
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
        const session = await trx
          .selectFrom("whatsapp_connection_sessions")
          .select("id")
          .where("whatsapp_connection_id", "=", connectionId)
          .where("ended_at", "is", null)
          .executeTakeFirstOrThrow();
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
        await updateSessionStatus(trx, session.id, "connecting");
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

connectionRoutes.post(
  "/:connectionId/relink",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    await whatsappService.relinkArchivedConnection(
      c.get("tenantDb"),
      c.get("companyId"),
      c.req.param("connectionId")!,
      c.get("user").id,
    );
    await createAuditLog({
      companyId: c.get("companyId"),
      userId: c.get("user").id,
      action: "connection.relinked",
      entityType: "whatsapp_connection",
      entityId: c.req.param("connectionId")!,
      ipAddress: getClientIp(c),
    });
    return c.json({
      success: true,
      message: "New pairing session initiated for the archived account",
    });
  },
);

/**
 * POST /connections/:connectionId/disconnect - Disconnect specific connection
 */
connectionRoutes.post(
  "/:connectionId/disconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const companyId = c.get("companyId");
    const connectionId = c.req.param("connectionId")!;
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
    const connectionId = c.req.param("connectionId")!;
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
