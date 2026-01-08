/**
 * Message event handlers - incoming messages, receipts, send confirmations
 */

import type {
  MessageEvent,
  ReceiptEvent,
  SendConfirmationEvent,
} from "../../lib/nats/index.js";
import { type MessageType } from "@whatsapp-web/database";
import {
  toDbDate,
  toDate,
  extractPhoneFromJid,
  normalizeJid,
} from "@whatsapp-web/shared";
import { getTenantConnection } from "../tenant.service.js";
import { broadcastToCompany } from "../../routes/ws/index.js";
import { updateMessageSearchVector } from "../search.service.js";
import { indexMessage, type MessageDocument } from "../meilisearch.service.js";
import { formatError } from "../../lib/logger.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles incoming WhatsApp messages
 */
export async function handleMessageEvent(event: MessageEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { companyId, connectionId, from: payload.from },
    "Message received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Get the connection by ID if provided, otherwise get any connected one
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

    // Get or create contact - normalize JID first to remove device suffix
    const rawContactJid = payload.fromMe ? payload.to : payload.from;
    const contactJid = normalizeJid(rawContactJid);
    let contact = await tenantDb
      .selectFrom("contacts")
      .select(["id"])
      .where("jid", "=", contactJid)
      .executeTakeFirst();

    if (!contact) {
      const contactId = crypto.randomUUID();
      // Extract phone number from JID (removes device suffix like ":3")
      const phoneNumber = extractPhoneFromJid(contactJid);
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: contactJid,
          phone_number: phoneNumber,
          is_group: contactJid.includes("@g.us"),
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .execute();
      contact = { id: contactId };
    }

    // Store the message - also normalize sender_jid
    // Determine media download status based on whether it's a history sync with deferred media
    const hasMediaReference = payload.mediaDirectPath && payload.isHistorySync;
    const mediaDownloadStatus = hasMediaReference
      ? "pending"
      : payload.mediaUrl
        ? "completed"
        : null;

    const messageId = crypto.randomUUID();
    await tenantDb
      .insertInto("messages")
      .values({
        id: messageId,
        whatsapp_connection_id: connection.id,
        contact_id: contact.id,
        message_id: payload.messageId,
        from_me: payload.fromMe,
        sender_jid: normalizeJid(payload.from),
        message_type: payload.messageType as MessageType,
        content: payload.content,
        media_url: payload.mediaUrl || null,
        media_mime_type: payload.mediaType || null,
        media_size: payload.mediaSize || null,
        // Deferred media download fields
        media_direct_path: payload.mediaDirectPath || null,
        media_key: payload.mediaKey
          ? Buffer.from(payload.mediaKey, "base64")
          : null,
        media_file_sha256: payload.mediaFileSha256
          ? Buffer.from(payload.mediaFileSha256, "base64")
          : null,
        media_file_enc_sha256: payload.mediaFileEncSha256
          ? Buffer.from(payload.mediaFileEncSha256, "base64")
          : null,
        media_download_status: mediaDownloadStatus,
        quoted_message_id: payload.quotedMessageId || null,
        is_forwarded: false,
        is_starred: false,
        deleted_by_sender: false,
        status: payload.fromMe ? "sent" : "delivered",
        timestamp: toDbDate(payload.timestamp),
        created_at: toDbDate(),
      })
      .execute();

    logger.debug({ messageId, companyId }, "Stored message");

    // Index message for search (run in background, don't block message processing)
    // Get contact name for search indexing
    const contactForSearch = await tenantDb
      .selectFrom("contacts")
      .select(["push_name", "custom_name", "jid", "is_group"])
      .where("id", "=", contact.id)
      .executeTakeFirst();

    const contactName =
      contactForSearch?.custom_name || contactForSearch?.push_name || null;

    // Update PostgreSQL full-text search vector
    updateMessageSearchVector(companyId, messageId).catch((err) => {
      logger.error(formatError(err), "Failed to update search vector");
    });

    // Index in Meilisearch for better search experience
    const messageDoc: MessageDocument = {
      id: messageId,
      companyId,
      contactId: contact.id,
      contactName,
      contactJid: contactForSearch?.jid || contactJid,
      isGroup: contactForSearch?.is_group || contactJid.includes("@g.us"),
      messageId: payload.messageId,
      content: payload.content || null,
      messageType: payload.messageType || "text",
      timestamp: toDate(payload.timestamp)?.getTime() || Date.now(),
      fromMe: payload.fromMe,
    };

    indexMessage(companyId, messageDoc).catch((err) => {
      logger.error(formatError(err), "Failed to index message in Meilisearch");
    });

    // Skip notifications, unread counts, and broadcasts for history sync messages
    // History sync imports hundreds of old messages - we don't want to flood the notification system
    if (payload.isHistorySync) {
      logger.debug(
        { messageId, companyId, contactId: contact.id },
        "Skipping notifications for history sync message",
      );
    }

    // Update conversation_states: increment unread count for incoming messages
    // Skip for history sync messages to avoid inflating unread counts with old messages
    if (!payload.fromMe && !payload.isHistorySync) {
      // Try to update existing conversation_states row
      const updateResult = await tenantDb
        .updateTable("conversation_states")
        .set((eb) => ({
          unread_count: eb("unread_count", "+", 1),
          last_message_at: toDbDate(payload.timestamp),
          last_message_preview: payload.content?.substring(0, 100) || null,
          updated_at: toDbDate(),
        }))
        .where("contact_id", "=", contact.id)
        .executeTakeFirst();

      // If no row exists, create one with unread_count = 1
      if (updateResult.numUpdatedRows === BigInt(0)) {
        await tenantDb
          .insertInto("conversation_states")
          .values({
            contact_id: contact.id,
            unread_count: 1,
            last_message_at: toDbDate(payload.timestamp),
            last_message_preview: payload.content?.substring(0, 100) || null,
          })
          .execute();
      }

      // Note: We don't create notification_history entries for regular messages
      // because the chat UI already shows unread counts via conversation_states
      // and new messages appear in real-time via the message:new WebSocket event.
      // notification_history is reserved for: assignments, mentions, team, system events
    }

    // Broadcast to WebSocket clients with proper format for frontend
    // Frontend expects { message: Message, conversationId: string }
    // Skip for history sync messages to avoid flooding WebSocket during initial sync
    if (!payload.isHistorySync) {
      broadcastToCompany(companyId, {
        type: "message:new",
        connectionId,
        payload: {
          message: {
            id: messageId,
            conversationId: contact.id,
            senderId: payload.from,
            senderType: payload.fromMe ? "user" : "contact",
            content: payload.content || "",
            messageType: payload.messageType || "text",
            status: payload.fromMe ? "sent" : "delivered",
            whatsappMessageId: payload.messageId,
            metadata: payload.mediaUrl
              ? { mediaUrl: payload.mediaUrl }
              : undefined,
            replyToMessageId: payload.quotedMessageId,
            isForwarded: false,
            isDeleted: false,
            isStarred: false,
            createdAt: payload.timestamp,
            updatedAt: payload.timestamp,
          },
          conversationId: contact.id,
        },
        timestamp: event.timestamp,
      });
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to store message");
  }
}

/**
 * Maps WhatsApp receipt types to database message_status enum values
 * WhatsApp types: "sender", "delivered", "read", "played", ""
 * DB enum: "pending", "sent", "delivered", "read", "failed"
 */
function mapReceiptStatus(
  waStatus: string,
): "sent" | "delivered" | "read" | null {
  switch (waStatus) {
    case "sender":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
    case "played":
      return "read";
    default:
      // Unknown or empty status - skip update
      return null;
  }
}

/**
 * Handles message receipt/status updates
 */
export async function handleReceiptEvent(event: ReceiptEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { status: payload.status, messageId: payload.messageId, connectionId },
    "Receipt received",
  );

  // Map WhatsApp receipt type to database enum
  const dbStatus = mapReceiptStatus(payload.status);
  if (!dbStatus) {
    logger.debug({ status: payload.status }, "Skipping unknown receipt status");
    return;
  }

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update message status in database and return the message info
    // Note: We store the WhatsApp message ID in message_id column
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({
        status: dbStatus,
      })
      .where("message_id", "=", payload.messageId)
      .returning(["id", "contact_id"])
      .executeTakeFirst();

    logger.debug(
      {
        status: dbStatus,
        waMessageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      "Updated message status",
    );

    // Broadcast to WebSocket clients with correct message:status format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      broadcastToCompany(companyId, {
        type: "message:status",
        connectionId,
        payload: {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: dbStatus,
        },
        timestamp: event.timestamp,
      });
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle receipt");
  }
}

/**
 * Handles send confirmation events
 * Updates a message from pending status with its real WhatsApp message ID
 */
export async function handleSendConfirmationEvent(
  event: SendConfirmationEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    {
      pendingMessageId: payload.pendingMessageId,
      messageId: payload.messageId,
      connectionId,
    },
    "Send confirmation received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update the message with the real WhatsApp ID and set status to sent
    // Also return the updated message to get internal ID and contact_id
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({
        message_id: payload.messageId,
        status: "sent",
      })
      .where("message_id", "=", payload.pendingMessageId)
      .returning(["id", "contact_id"])
      .executeTakeFirst();

    logger.debug(
      {
        pendingMessageId: payload.pendingMessageId,
        messageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      "Updated message with real ID",
    );

    // Broadcast to WebSocket clients with the correct payload format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      broadcastToCompany(companyId, {
        type: "message:status",
        connectionId,
        payload: {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: "sent",
        },
        timestamp: event.timestamp,
      });
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle send confirmation");
  }
}
