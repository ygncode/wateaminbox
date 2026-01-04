import type { JetStreamSubscription } from "nats";
import {
  subscribeToAllEvents,
  type WhatsAppEvent,
  type QREvent,
  type ConnectionEvent,
  type MessageEvent,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type StatusEvent,
  type ContactEvent,
} from "../lib/nats.js";
import { getTenantConnection } from "./tenant.service.js";
import { updateConnectionStatus } from "./whatsapp.service.js";
import { broadcastToCompany } from "../routes/ws.js";

// Subscription handle
let eventSubscription: JetStreamSubscription | null = null;
let isInitialized = false;

/**
 * Initializes the message event handler
 * Subscribes to NATS WhatsApp events and processes them
 */
export async function initializeMessageHandler(): Promise<void> {
  if (isInitialized) {
    console.log("[MessageHandler] Already initialized");
    return;
  }

  try {
    eventSubscription = await subscribeToAllEvents(handleWhatsAppEvent);
    isInitialized = true;
    console.log(
      "[MessageHandler] Initialized and subscribed to WhatsApp events",
    );
  } catch (error) {
    console.error("[MessageHandler] Failed to initialize:", error);
    throw error;
  }
}

/**
 * Shuts down the message event handler
 */
export async function shutdownMessageHandler(): Promise<void> {
  if (eventSubscription) {
    eventSubscription.unsubscribe();
    eventSubscription = null;
  }
  isInitialized = false;
  console.log("[MessageHandler] Shutdown complete");
}

/**
 * Handles incoming WhatsApp events from NATS
 * Exported for testing purposes
 */
export async function handleWhatsAppEvent(event: WhatsAppEvent): Promise<void> {
  const { type, companyId, connectionId } = event;

  console.log(
    `[MessageHandler] Received ${type} event for company ${companyId}, connection ${connectionId || "unknown"}`,
  );

  try {
    switch (type) {
      case "qr":
        await handleQREvent(event as QREvent);
        break;

      case "connected":
        await handleConnectedEvent(event as ConnectionEvent);
        break;

      case "disconnected":
        await handleDisconnectedEvent(event as ConnectionEvent);
        break;

      case "message":
        await handleMessageEvent(event as MessageEvent);
        break;

      case "receipt":
        await handleReceiptEvent(event as ReceiptEvent);
        break;

      case "send_confirmation":
        await handleSendConfirmationEvent(event as SendConfirmationEvent);
        break;

      case "status":
        await handleStatusEvent(event as StatusEvent);
        break;

      case "contact":
        await handleContactEvent(event as ContactEvent);
        break;

      case "error":
        await handleErrorEvent(event);
        break;

      default:
        console.warn(`[MessageHandler] Unknown event type: ${type}`);
    }
  } catch (error) {
    console.error(`[MessageHandler] Error processing ${type} event:`, error);
  }
}

/**
 * Handles QR code events
 */
async function handleQREvent(event: QREvent): Promise<void> {
  const { companyId, connectionId } = event;

  // QR events are handled by WebSocket broadcast
  // Just log for monitoring
  console.log(
    `[MessageHandler] QR code generated for company ${companyId}, connection ${connectionId}`,
  );

  // Broadcast to connected WebSocket clients with connectionId
  broadcastToCompany(companyId, {
    type: "qr",
    connectionId,
    payload: event.payload,
    timestamp: event.timestamp,
  });
}

/**
 * Handles WhatsApp connection established events
 */
async function handleConnectedEvent(event: ConnectionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] WhatsApp connected for company ${companyId}, connection ${connectionId}`,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update connection status in database with connectionId
    await updateConnectionStatus(
      tenantDb,
      "connected",
      connectionId,
      payload.phoneNumber,
      payload.jid,
    );

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: "connected",
      connectionId,
      payload: {
        phoneNumber: payload.phoneNumber,
        jid: payload.jid,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(`[MessageHandler] Failed to handle connected event:`, error);
  }
}

/**
 * Handles WhatsApp disconnection events
 */
async function handleDisconnectedEvent(event: ConnectionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] WhatsApp disconnected for company ${companyId}, connection ${connectionId}:`,
    payload.reason,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update connection status in database with connectionId
    await updateConnectionStatus(tenantDb, "disconnected", connectionId);

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: "disconnected",
      connectionId,
      payload: {
        reason: payload.reason,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(
      `[MessageHandler] Failed to handle disconnected event:`,
      error,
    );
  }
}

/**
 * Handles incoming WhatsApp messages
 */
async function handleMessageEvent(event: MessageEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] Message received for company ${companyId}, connection ${connectionId} from ${payload.from}`,
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
      console.warn(
        `[MessageHandler] No active connection for company ${companyId}`,
      );
      return;
    }

    // Get or create contact
    const contactJid = payload.fromMe ? payload.to : payload.from;
    let contact = await tenantDb
      .selectFrom("contacts")
      .select(["id"])
      .where("jid", "=", contactJid)
      .executeTakeFirst();

    if (!contact) {
      const contactId = crypto.randomUUID();
      // Extract phone number from JID (e.g., "6594603306@s.whatsapp.net" -> "6594603306")
      const phoneNumber = contactJid.split("@")[0] || null;
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: contactJid,
          phone_number: phoneNumber,
          is_group: contactJid.includes("@g.us"),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
      contact = { id: contactId };
    }

    // Store the message
    const messageId = crypto.randomUUID();
    await tenantDb
      .insertInto("messages")
      .values({
        id: messageId,
        whatsapp_connection_id: connection.id,
        contact_id: contact.id,
        message_id: payload.messageId,
        from_me: payload.fromMe,
        sender_jid: payload.from,
        message_type: payload.messageType as any,
        content: payload.content,
        media_url: payload.mediaUrl || null,
        quoted_message_id: payload.quotedMessageId || null,
        is_forwarded: false,
        is_starred: false,
        deleted_by_sender: false,
        status: payload.fromMe ? "sent" : "delivered",
        timestamp: new Date(payload.timestamp),
        created_at: new Date(),
      })
      .execute();

    console.log(
      `[MessageHandler] Stored message ${messageId} for company ${companyId}`,
    );

    // Broadcast to WebSocket clients with proper format for frontend
    // Frontend expects { message: Message, conversationId: string }
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
  } catch (error) {
    console.error(`[MessageHandler] Failed to store message:`, error);
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
async function handleReceiptEvent(event: ReceiptEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] Receipt ${payload.status} for message ${payload.messageId}, connection ${connectionId}`,
  );

  // Map WhatsApp receipt type to database enum
  const dbStatus = mapReceiptStatus(payload.status);
  if (!dbStatus) {
    console.log(
      `[MessageHandler] Skipping unknown receipt status: "${payload.status}"`,
    );
    return;
  }

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update message status in database
    // Note: We store the WhatsApp message ID in message_id column
    const result = await tenantDb
      .updateTable("messages")
      .set({
        status: dbStatus,
      })
      .where("message_id", "=", payload.messageId)
      .executeTakeFirst();

    console.log(
      `[MessageHandler] Updated message status to ${dbStatus} for message ${payload.messageId} (rows affected: ${result.numUpdatedRows})`,
    );

    // Broadcast to WebSocket clients with mapped status and connectionId
    broadcastToCompany(companyId, {
      type: "receipt",
      connectionId,
      payload: {
        messageId: payload.messageId,
        status: dbStatus,
        timestamp: payload.timestamp,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(`[MessageHandler] Failed to handle receipt:`, error);
  }
}

/**
 * Handles send confirmation events
 * Updates a message from pending status with its real WhatsApp message ID
 */
async function handleSendConfirmationEvent(
  event: SendConfirmationEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] Send confirmation for pending message ${payload.pendingMessageId} -> real ID ${payload.messageId}, connection ${connectionId}`,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update the message with the real WhatsApp ID and set status to sent
    const result = await tenantDb
      .updateTable("messages")
      .set({
        message_id: payload.messageId,
        status: "sent",
      })
      .where("message_id", "=", payload.pendingMessageId)
      .executeTakeFirst();

    console.log(
      `[MessageHandler] Updated message ${payload.pendingMessageId} -> ${payload.messageId}, status set to sent (rows affected: ${result.numUpdatedRows})`,
    );

    // Broadcast to WebSocket clients with the status update
    broadcastToCompany(companyId, {
      type: "message:status",
      connectionId,
      payload: {
        pendingMessageId: payload.pendingMessageId,
        messageId: payload.messageId,
        status: "sent",
        timestamp: payload.timestamp,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(
      `[MessageHandler] Failed to handle send confirmation:`,
      error,
    );
  }
}

/**
 * Handles WhatsApp status updates
 */
async function handleStatusEvent(event: StatusEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] Status update received for company ${companyId}, connection ${connectionId} from ${payload.fromJid}`,
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
      console.warn(
        `[MessageHandler] No active connection for company ${companyId}`,
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
        timestamp: new Date(payload.timestamp),
        expires_at: new Date(payload.expiresAt),
      })
      .execute();

    console.log(
      `[MessageHandler] Stored status ${statusId} for company ${companyId}`,
    );

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: "status",
      connectionId,
      payload: {
        id: statusId,
        ...payload,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(`[MessageHandler] Failed to store status:`, error);
  }
}

/**
 * Handles contact sync events from history sync
 */
async function handleContactEvent(event: ContactEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.log(
    `[MessageHandler] Contact sync received for company ${companyId}, connection ${connectionId}: ${payload.jid}`,
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
      console.warn(
        `[MessageHandler] No active connection for company ${companyId}`,
      );
      return;
    }

    // Check if contact already exists
    const existingContact = await tenantDb
      .selectFrom("contacts")
      .select(["id"])
      .where("jid", "=", payload.jid)
      .executeTakeFirst();

    if (existingContact) {
      // Update existing contact
      await tenantDb
        .updateTable("contacts")
        .set({
          push_name: payload.displayName || payload.name || null,
          is_group: payload.isGroup,
          profile_picture_url: payload.profilePictureUrl || null,
          updated_at: new Date(),
        })
        .where("id", "=", existingContact.id)
        .execute();

      console.log(
        `[MessageHandler] Updated contact ${payload.jid} for company ${companyId}`,
      );
    } else {
      // Create new contact
      const contactId = crypto.randomUUID();
      // Extract phone number from JID (e.g., "6594603306@s.whatsapp.net" -> "6594603306")
      const phoneNumber = payload.jid.split("@")[0] || null;
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: payload.jid,
          phone_number: phoneNumber,
          push_name: payload.displayName || payload.name || null,
          is_group: payload.isGroup,
          profile_picture_url: payload.profilePictureUrl || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      console.log(
        `[MessageHandler] Created contact ${payload.jid} for company ${companyId}`,
      );
    }

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: "contact",
      connectionId,
      payload,
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(`[MessageHandler] Failed to handle contact event:`, error);
  }
}

/**
 * Handles error events from WhatsApp worker
 */
async function handleErrorEvent(event: WhatsAppEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  console.error(
    `[MessageHandler] Error for company ${companyId}, connection ${connectionId}:`,
    payload,
  );

  // Broadcast error to WebSocket clients with connectionId
  broadcastToCompany(companyId, {
    type: "error",
    connectionId,
    payload,
    timestamp: event.timestamp,
  });
}

/**
 * Gets initialization status
 */
export function isMessageHandlerInitialized(): boolean {
  return isInitialized;
}
