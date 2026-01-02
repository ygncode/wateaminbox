import type { Subscription } from "nats";
import {
  subscribeToAllEvents,
  type WhatsAppEvent,
  type QREvent,
  type ConnectionEvent,
  type MessageEvent,
  type ReceiptEvent,
  type StatusEvent,
  type ContactEvent,
} from "../lib/nats.js";
import { getTenantConnection } from "./tenant.service.js";
import { updateConnectionStatus } from "./whatsapp.service.js";
import { broadcastToCompany } from "../routes/ws.js";

// Subscription handle
let eventSubscription: Subscription | null = null;
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
 */
async function handleWhatsAppEvent(event: WhatsAppEvent): Promise<void> {
  const { type, companyId } = event;

  console.log(
    `[MessageHandler] Received ${type} event for company ${companyId}`,
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
  // QR events are handled by WebSocket broadcast
  // Just log for monitoring
  console.log(
    `[MessageHandler] QR code generated for company ${event.companyId}`,
  );

  // Broadcast to connected WebSocket clients
  broadcastToCompany(event.companyId, {
    type: "qr",
    payload: event.payload,
    timestamp: event.timestamp,
  });
}

/**
 * Handles WhatsApp connection established events
 */
async function handleConnectedEvent(event: ConnectionEvent): Promise<void> {
  const { companyId, payload } = event;

  console.log(`[MessageHandler] WhatsApp connected for company ${companyId}`);

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update connection status in database
    await updateConnectionStatus(
      tenantDb,
      "connected",
      payload.phoneNumber,
      payload.jid,
    );

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "connected",
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
  const { companyId, payload } = event;

  console.log(
    `[MessageHandler] WhatsApp disconnected for company ${companyId}:`,
    payload.reason,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update connection status in database
    await updateConnectionStatus(tenantDb, "disconnected");

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "disconnected",
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
  const { companyId, payload } = event;

  console.log(
    `[MessageHandler] Message received for company ${companyId} from ${payload.from}`,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Get the active connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("status", "=", "connected")
      .executeTakeFirst();

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
        timestamp: new Date(payload.timestamp),
        created_at: new Date(),
      })
      .execute();

    console.log(
      `[MessageHandler] Stored message ${messageId} for company ${companyId}`,
    );

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "message",
      payload: {
        id: messageId,
        ...payload,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(`[MessageHandler] Failed to store message:`, error);
  }
}

/**
 * Handles message receipt/status updates
 */
async function handleReceiptEvent(event: ReceiptEvent): Promise<void> {
  const { companyId, payload } = event;

  console.log(
    `[MessageHandler] Receipt ${payload.status} for message ${payload.messageId}`,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update message status in database
    // Note: We store the WhatsApp message ID in message_id column
    await tenantDb
      .updateTable("messages")
      .set({
        // Status is not stored directly, but we could add a status column
        // For now, we just broadcast the receipt to clients
      })
      .where("message_id", "=", payload.messageId)
      .execute();

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "receipt",
      payload: {
        messageId: payload.messageId,
        status: payload.status,
        timestamp: payload.timestamp,
      },
      timestamp: event.timestamp,
    });
  } catch (error) {
    console.error(`[MessageHandler] Failed to handle receipt:`, error);
  }
}

/**
 * Handles WhatsApp status updates
 */
async function handleStatusEvent(event: StatusEvent): Promise<void> {
  const { companyId, payload } = event;

  console.log(
    `[MessageHandler] Status update received for company ${companyId} from ${payload.fromJid}`,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Get the active connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("status", "=", "connected")
      .executeTakeFirst();

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

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "status",
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
  const { companyId, payload } = event;

  console.log(
    `[MessageHandler] Contact sync received for company ${companyId}: ${payload.jid}`,
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Get the active connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("status", "=", "connected")
      .executeTakeFirst();

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
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      console.log(
        `[MessageHandler] Created contact ${payload.jid} for company ${companyId}`,
      );
    }

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: "contact",
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
  const { companyId, payload } = event;

  console.error(`[MessageHandler] Error for company ${companyId}:`, payload);

  // Broadcast error to WebSocket clients
  broadcastToCompany(companyId, {
    type: "error",
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
