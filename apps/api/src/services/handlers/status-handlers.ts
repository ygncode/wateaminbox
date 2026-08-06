/**
 * Status event handlers - status updates, sync status, media downloads
 */

import { toDbDate } from "@wateaminbox/shared";
import { sql } from "kysely";
import { formatError } from "../../lib/logger.js";
import type {
  DownloadResponseEvent,
  StatusEvent,
  SyncStatusEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { broadcastToContactViewers } from "../message-broadcast.service.js";
import { getTenantConnection } from "../tenant.service.js";
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

    if (!connectionId) {
      logger.error({ companyId }, "Quarantining status without connection ID");
      return;
    }
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("id", "=", connectionId)
      .executeTakeFirst();

    if (!connection) {
      logger.error(
        { companyId, connectionId },
        "Quarantining status for unknown connection",
      );
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
        mediaUrl: undefined,
        mediaAvailable: Boolean(payload.mediaUrl),
      },
      connectionId,
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to store status");
    throw error;
  }
}

type StoredSyncStatus = "syncing" | "completed" | "interrupted" | null;
type IncomingSyncStatus = SyncStatusEvent["payload"]["status"];

/**
 * Progress/completion may be redelivered after a lifecycle has ended. Requiring
 * an active `starting` transition prevents any late progress event from
 * resurrecting a completed sync in either PostgreSQL or the browser.
 */
export function shouldApplySyncStatusEvent(
  current: StoredSyncStatus,
  incoming: IncomingSyncStatus,
): boolean {
  return incoming === "starting" || current === "syncing";
}

export function getPersistedSyncCounters(
  status: IncomingSyncStatus,
  messageCount: number,
  conversations: number,
): { sync_message_count: number; sync_conversation_count: number } {
  if (status === "starting") {
    return { sync_message_count: 0, sync_conversation_count: 0 };
  }
  return {
    sync_message_count: Math.max(0, messageCount),
    sync_conversation_count: Math.max(0, conversations),
  };
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

    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["sync_status"])
      .where("id", "=", connectionId)
      .executeTakeFirst();

    if (!connection) {
      logger.warn(
        { connectionId },
        "Ignoring sync event for missing connection",
      );
      return;
    }
    if (!shouldApplySyncStatusEvent(connection.sync_status, payload.status)) {
      logger.warn(
        {
          connectionId,
          current: connection.sync_status,
          incoming: payload.status,
        },
        "Ignoring out-of-order sync event",
      );
      return;
    }
    if (
      payload.status === "starting" &&
      connection.sync_status === "interrupted"
    ) {
      logger.info({ connectionId }, "Resuming interrupted sync");
    }

    const now = toDbDate();
    const counters = getPersistedSyncCounters(
      payload.status,
      payload.messageCount,
      payload.conversations,
    );
    if (payload.status === "starting") {
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          sync_status: "syncing",
          ...counters,
          updated_at: now,
        })
        .where("id", "=", connectionId)
        .execute();
    } else if (payload.status === "progress") {
      // Progress is also a heartbeat. This prevents a legitimate long-running
      // media import from being mistaken for an abandoned sync.
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          sync_message_count: sql<number>`GREATEST(sync_message_count, ${counters.sync_message_count})`,
          sync_conversation_count: sql<number>`GREATEST(sync_conversation_count, ${counters.sync_conversation_count})`,
          updated_at: now,
        })
        .where("id", "=", connectionId)
        .where("sync_status", "=", "syncing")
        .execute();
    } else {
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          sync_status: "completed",
          sync_message_count: sql<number>`GREATEST(sync_message_count, ${counters.sync_message_count})`,
          sync_conversation_count: sql<number>`GREATEST(sync_conversation_count, ${counters.sync_conversation_count})`,
          last_sync_at: now,
          updated_at: now,
        })
        .where("id", "=", connectionId)
        .where("sync_status", "=", "syncing")
        .execute();
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
    throw error;
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
      // First response wins.
      //
      // A download claim whose lease expires while the worker is still running
      // can be re-claimed, producing a second command for the same message and
      // eventually a second response. Without this guard the later response
      // would overwrite `media_url` with its own upload, orphaning the object
      // the first one stored and emitting a duplicate `media:downloaded`.
      //
      // Matching on "not already completed" is a compare-and-set: PostgreSQL
      // re-checks it under the row lock, so exactly one of two concurrent
      // responses updates a row. The loser simply finds nothing to do.
      const updatedMessage = await tenantDb
        .updateTable("messages")
        .set({
          media_url: payload.mediaUrl,
          media_size: payload.mediaSize || null,
          media_download_status: "completed",
          media_downloaded_at: toDbDate(),
        })
        .where("id", "=", payload.messageId)
        .where("whatsapp_connection_id", "=", connectionId)
        .where((eb) =>
          eb.or([
            eb("media_download_status", "is", null),
            eb("media_download_status", "!=", "completed"),
            eb("media_url", "is", null),
          ]),
        )
        .returning(["id", "contact_id"])
        .executeTakeFirst();

      if (!updatedMessage) {
        // Either the message is gone, or another response already completed
        // it. Neither is an error, but a duplicate download means a stored
        // object nobody references - worth seeing in the logs.
        logger.info(
          { messageId: payload.messageId, connectionId },
          "Ignoring media download response for an already-settled message",
        );
      }

      if (updatedMessage) {
        logger.info(
          {
            messageId: payload.messageId,
            mediaUrl: payload.mediaUrl,
          },
          "Media download completed",
        );

        // Broadcast to clients
        await broadcastToContactViewers(
          companyId,
          updatedMessage.contact_id,
          "media:downloaded",
          {
            messageId: updatedMessage.id,
            conversationId: updatedMessage.contact_id,
            mediaAvailable: true,
            mediaSize: payload.mediaSize,
          },
          { connectionId },
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
        .where("whatsapp_connection_id", "=", connectionId)
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
        .where("whatsapp_connection_id", "=", connectionId)
        .executeTakeFirst();

      if (message) {
        await broadcastToContactViewers(
          companyId,
          message.contact_id,
          "media:download_failed",
          {
            messageId: message.id,
            conversationId: message.contact_id,
            error: payload.error,
          },
          { connectionId },
        );
      }
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle download response");
    throw error;
  }
}
