/**
 * WhatsApp Status and Sync Routes
 *
 * Routes for checking connection limits, sync status, and resetting stale syncs.
 */
import { nowMs, parseDate, toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createLogger, formatError } from "../../lib/logger.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromHeader } from "../../middleware/tenant.js";
import * as whatsappService from "../../services/whatsapp.service.js";

const logger = createLogger("WhatsAppStatusRoutes");

export const statusRoutes = new Hono();

/**
 * GET /limits - Get connection limits for the company
 */
statusRoutes.get(
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
      logger.error(
        { err: formatError(error) },
        "Failed to get connection limits",
      );
      throw new HTTPException(500, {
        message: "Failed to get connection limits",
      });
    }
  },
);

/**
 * GET /sync-status - Gets sync status for all connections (for page reload handling)
 */
statusRoutes.get(
  "/sync-status",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const tenantDb = c.get("tenantDb");

    try {
      // Get all connections that are currently syncing
      const syncingConnections = await tenantDb
        .selectFrom("whatsapp_connections")
        .select([
          "id",
          "name",
          "phone_number",
          "sync_status",
          "sync_message_count",
          "sync_conversation_count",
          "updated_at",
        ])
        .where("sync_status", "=", "syncing")
        .execute();

      // Progress updates `updated_at` as a heartbeat. Keep a generous fallback
      // for imports containing slow media downloads.
      const STALE_THRESHOLD_MS = 30 * 60 * 1000;
      const currentMs = nowMs();
      const activeConnections = [];
      const staleConnectionIds: string[] = [];

      for (const conn of syncingConnections) {
        const updatedAt = parseDate(conn.updated_at)?.valueOf() ?? 0;
        if (!updatedAt || currentMs - updatedAt > STALE_THRESHOLD_MS) {
          staleConnectionIds.push(conn.id);
        } else {
          activeConnections.push(conn);
        }
      }

      // Auto-correct stale connections in background
      if (staleConnectionIds.length > 0) {
        logger.warn(
          { count: staleConnectionIds.length, ids: staleConnectionIds },
          "Found stale syncing connections, resetting to completed",
        );
        tenantDb
          .updateTable("whatsapp_connections")
          .set({
            sync_status: "completed",
            updated_at: toDbDate(),
          })
          .where("id", "in", staleConnectionIds)
          .execute()
          .catch((err) => {
            logger.error(
              { err: formatError(err) },
              "Failed to auto-reset stale sync status",
            );
          });
      }

      return c.json({
        success: true,
        data: {
          syncing: activeConnections.length > 0,
          connections: activeConnections,
        },
      });
    } catch (error) {
      logger.error({ err: formatError(error) }, "Failed to get sync status");
      throw new HTTPException(500, {
        message: "Failed to get sync status",
      });
    }
  },
);

/**
 * POST /sync-reset - Resets sync status for all connections (failsafe for stuck syncs)
 */
statusRoutes.post(
  "/sync-reset",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const tenantDb = c.get("tenantDb");

    try {
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          sync_status: "completed",
          updated_at: toDbDate(),
        })
        .where("sync_status", "=", "syncing")
        .execute();

      return c.json({
        success: true,
        message: "Sync status reset successfully",
      });
    } catch (error) {
      logger.error({ err: formatError(error) }, "Failed to reset sync status");
      throw new HTTPException(500, {
        message: "Failed to reset sync status",
      });
    }
  },
);
