/**
 * Status event handlers - status updates, sync status, media downloads
 */

import type {
  StatusEvent,
  SyncStatusEvent,
  DownloadResponseEvent,
} from "../../lib/nats/index.js";
import { toDbDate } from "@wateaminbox/shared";
import { getTenantConnection } from "../tenant.service.js";
import { broadcastToCompany } from "../../lib/pusher.js";
import { formatError } from "../../lib/logger.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles WhatsApp status updates
 */
export async function handleStatusEvent(event: StatusEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { companyId, connectionId, fromJid: payload.fromJid },
    "Status update received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Get the connection by ID if provided
    let connection;
    if (connectionId) {
      connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id"])
        .where("id", "=", connectionId)
        .executeTakeFirst();
    }

    if (!connection) {
      // Fallback: get any active connection
      connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id"])
        .where("status", "=", "connected")
        .executeTakeFirst();
    }

    if (!connection) {
      logger.warn({ companyId }, "No active connection for company");
      return;
    }

    // Store the status update
    const statusId = crypto.randomUUID();
    await tenantDb
      .insertInto("status_updates")
      .values({
        id: statusId,
        whatsapp_connection_id: connection.id,
        status_id: payload.statusId,
        from_jid: payload.fromJid,
        media_type: payload.mediaType,
        media_url: payload.mediaUrl,
        caption: payload.caption,
        timestamp: toDbDate(payload.timestamp),
        expires_at: toDbDate(payload.expiresAt),
      })
      .execute();

    logger.debug({ statusId, companyId }, "Stored status update");

    // Broadcast to clients with connectionId
    await broadcastToCompany(
      companyId,
      "status",
      {
        id: statusId,
        ...payload,
      },
      connectionId,
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to store status");
  }
}

/**
 * Handles sync status events from WhatsApp history sync
 * Updates database sync_status and broadcasts progress to realtime clients
 */
export async function handleSyncStatusEvent(
  event: SyncStatusEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.info(
    {
      companyId,
      connectionId,
      status: payload.status,
      messageCount: payload.messageCount,
      conversations: payload.conversations,
    },
    "Sync status event received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update database sync_status for starting/completed (not progress to avoid excessive updates)
    if (payload.status === "starting" || payload.status === "completed") {
      const dbStatus = payload.status === "starting" ? "syncing" : "completed";

      // Check if previous sync was interrupted
      if (payload.status === "starting") {
        const connection = await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["sync_status"])
          .where("id", "=", connectionId)
          .executeTakeFirst();

        if (connection?.sync_status === "interrupted") {
          logger.info({ connectionId }, "Resuming interrupted sync");
        }
      }

      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          sync_status: dbStatus,
          updated_at: toDbDate(),
        })
        .where("id", "=", connectionId)
        .execute();

      logger.info(
        {
          connectionId,
          status: dbStatus,
        },
        "Updated connection sync_status",
      );
    }

    // Map NATS status to event type
    const eventTypeMap = {
      starting: "sync:start" as const,
      progress: "sync:progress" as const,
      completed: "sync:complete" as const,
    };

    // Broadcast to clients
    await broadcastToCompany(
      companyId,
      eventTypeMap[payload.status],
      {
        messageCount: payload.messageCount,
        conversations: payload.conversations,
      },
      connectionId,
    );

    logger.debug(
      {
        type: eventTypeMap[payload.status],
        connectionId,
      },
      "Broadcasted sync status to clients",
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to handle sync status event");
  }
}

/**
 * Handles download response events from the Go download handler
 * Updates message with downloaded media URL and broadcasts to realtime clients
 */
export async function handleDownloadResponseEvent(
  event: DownloadResponseEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.info(
    {
      companyId,
      connectionId,
      messageId: payload.messageId,
      success: payload.success,
      mediaUrl: payload.mediaUrl
        ? payload.mediaUrl.substring(0, 50) + "..."
        : undefined,
    },
    "Download response received from Go service",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    if (payload.success && payload.mediaUrl) {
      // Update message with downloaded media
      const updatedMessage = await tenantDb
        .updateTable("messages")
        .set({
          media_url: payload.mediaUrl,
          media_size: payload.mediaSize || null,
          media_download_status: "completed",
          media_downloaded_at: toDbDate(),
        })
        .where("id", "=", payload.messageId)
        .returning(["id", "contact_id"])
        .executeTakeFirst();

      if (updatedMessage) {
        logger.info(
          {
            messageId: payload.messageId,
            mediaUrl: payload.mediaUrl,
          },
          "Media download completed",
        );

        // Broadcast to clients
        await broadcastToCompany(
          companyId,
          "media:downloaded",
          {
            messageId: updatedMessage.id,
            conversationId: updatedMessage.contact_id,
            mediaUrl: payload.mediaUrl,
            mediaSize: payload.mediaSize,
          },
          connectionId,
        );
      }
    } else {
      // Update message with error status
      await tenantDb
        .updateTable("messages")
        .set({
          media_download_status: "failed",
          media_download_error: payload.error || "Unknown error",
        })
        .where("id", "=", payload.messageId)
        .execute();

      logger.error(
        {
          messageId: payload.messageId,
          error: payload.error,
        },
        "Media download failed",
      );

      // Broadcast failure to clients
      const message = await tenantDb
        .selectFrom("messages")
        .select(["id", "contact_id"])
        .where("id", "=", payload.messageId)
        .executeTakeFirst();

      if (message) {
        await broadcastToCompany(
          companyId,
          "media:download_failed",
          {
            messageId: message.id,
            conversationId: message.contact_id,
            error: payload.error,
          },
          connectionId,
        );
      }
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle download response");
  }
}
