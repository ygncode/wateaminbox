/**
 * Reaction and message revoke event handlers
 */

import type {
  ReactionEvent,
  MessageRevokeEvent,
} from "../../lib/nats/index.js";
import { toDbDate } from "@whatsapp-web/shared";
import { getTenantConnection } from "../tenant.service.js";
import { broadcastToCompany } from "../../routes/ws.js";
import { formatError } from "../../lib/logger.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles reaction events from WhatsApp
 * Stores reactions in database and broadcasts to WebSocket clients
 */
export async function handleReactionEvent(event: ReactionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    {
      companyId,
      from: payload.from,
      emoji: payload.emoji || "(removed)",
      messageId: payload.messageId,
    },
    "Reaction event received",
  );

  try {
    // Get database connection
    const tenantDb = getTenantConnection(companyId);

    // Find the message being reacted to (by WhatsApp message_id field, not the internal id)
    const message = await tenantDb
      .selectFrom("messages")
      .select(["id", "contact_id"])
      .where("message_id", "=", payload.messageId)
      .executeTakeFirst();

    if (!message) {
      logger.warn(
        { messageId: payload.messageId },
        "Message not found for reaction",
      );
      return;
    }

    if (payload.emoji) {
      // Add or update reaction
      await tenantDb
        .insertInto("message_reactions")
        .values({
          message_id: message.id, // Use internal message ID for FK
          reactor_jid: payload.from,
          emoji: payload.emoji,
        })
        .onConflict((oc) =>
          oc.columns(["message_id", "reactor_jid"]).doUpdateSet({
            emoji: payload.emoji,
          }),
        )
        .execute();
    } else {
      // Remove reaction (empty emoji)
      await tenantDb
        .deleteFrom("message_reactions")
        .where("message_id", "=", message.id) // Use internal message ID
        .where("reactor_jid", "=", payload.from)
        .execute();
    }

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "message:reaction",
      connectionId,
      payload: {
        messageId: message.id, // Use internal message ID
        contactId: message.contact_id, // Use contact_id instead of conversationId
        from: payload.from,
        emoji: payload.emoji,
        timestamp: payload.timestamp,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    logger.error(formatError(error), "Error handling reaction event");
  }
}

/**
 * Handles message revoke (deletion) events from WhatsApp
 * When a user deletes a message for everyone, this updates the database
 * and notifies WebSocket clients
 */
export async function handleMessageRevokeEvent(
  event: MessageRevokeEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { companyId, connectionId, messageId: payload.messageId },
    "Message revoke received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update the message to mark it as deleted by sender
    const result = await tenantDb
      .updateTable("messages")
      .set({
        deleted_by_sender: true,
        deleted_at: toDbDate(),
      })
      .where("message_id", "=", payload.messageId)
      .executeTakeFirst();

    if (result.numUpdatedRows > 0) {
      logger.debug(
        {
          messageId: payload.messageId,
          rowsAffected: result.numUpdatedRows.toString(),
        },
        "Marked message as deleted",
      );

      // Get the message to find the contact_id for broadcasting
      const message = await tenantDb
        .selectFrom("messages")
        .select(["id", "contact_id"])
        .where("message_id", "=", payload.messageId)
        .executeTakeFirst();

      if (message) {
        // Broadcast to WebSocket clients
        broadcastToCompany(companyId, {
          type: "message:deleted",
          connectionId,
          payload: {
            messageId: message.id,
            conversationId: message.contact_id,
            whatsappMessageId: payload.messageId,
          },
          timestamp: event.timestamp,
        });
      }
    } else {
      // Message not found - this could happen if:
      // 1. The message was never stored in our database (race condition)
      // 2. The message was already deleted
      // Log a warning but don't throw - this is expected in some edge cases
      logger.warn(
        { messageId: payload.messageId },
        "Message not found for revoke - may be race condition or never stored",
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle message revoke");
    // Don't throw - we want to continue processing other events
  }
}
