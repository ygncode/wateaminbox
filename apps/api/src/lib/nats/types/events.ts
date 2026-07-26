/**
 * NATS Event Types
 * Event interfaces for WhatsApp worker events
 */

import type { WhatsAppEvent } from "./base.js";

// Message revoke event
export interface MessageRevokeEvent extends WhatsAppEvent {
  type: "message_revoke";
  payload: {
    messageId: string;
    from: string;
    to: string;
    timestamp: string;
  };
}

// Profile picture update event
export interface ProfilePictureEvent extends WhatsAppEvent {
  type: "profile_picture";
  payload: {
    jid: string;
    profilePictureUrl: string;
    timestamp: string;
    remove?: boolean;
  };
}

// Labels sync event
export interface LabelsEvent extends WhatsAppEvent {
  type: "labels";
  payload: {
    labels: Array<{
      labelId: string;
      name: string;
      color: string | null;
      predefinedId: number | null;
    }>;
  };
}

// Catalogs sync event
export interface CatalogsEvent extends WhatsAppEvent {
  type: "catalogs";
  payload: {
    catalogs: Array<{
      catalogId: string;
      name: string;
      description?: string;
      currency?: string;
      status?: string;
      businessJid?: string;
      headerImageUrl?: string;
      productCount?: number;
    }>;
  };
}

// Catalog products sync event
export interface CatalogProductsEvent extends WhatsAppEvent {
  type: "catalog_products";
  payload: {
    catalogId: string;
    products: Array<{
      productId: string;
      name: string;
      description?: string;
      price?: number;
      currency?: string;
      imageUrls?: string[];
      sku?: string;
      category?: string;
      availability?: string;
      visibility?: string;
      url?: string;
      retailerId?: string;
    }>;
  };
}

// QR code event
export interface QREvent extends WhatsAppEvent {
  type: "qr";
  payload: {
    qrCode: string;
    expiresAt: string;
  };
}

// Connection status event
export interface ConnectionEvent extends WhatsAppEvent {
  type: "connected" | "disconnected";
  payload: {
    phoneNumber?: string;
    jid?: string;
    reason?: string;
  };
}

// Message received event
export interface MessageEvent extends WhatsAppEvent {
  type: "message";
  payload: {
    messageId: string;
    from: string;
    to: string;
    fromMe: boolean;
    content: string;
    messageType: string;
    status?: "pending" | "sent" | "delivered" | "read" | "failed";
    timestamp: string;
    mediaUrl?: string;
    quotedMessageId?: string;
    isGroup?: boolean;
    groupId?: string;
    // Additional fields from Go worker
    senderName?: string;
    caption?: string;
    fileName?: string;
    mediaType?: string;
    mediaSize?: number;
    // Deferred media download fields
    mediaDirectPath?: string;
    mediaKey?: string; // Base64 encoded
    mediaFileSha256?: string; // Base64 encoded
    mediaFileEncSha256?: string; // Base64 encoded
    isHistorySync?: boolean;
  };
}

// Message receipt event
export interface ReceiptEvent extends WhatsAppEvent {
  type: "receipt";
  payload: {
    messageId: string;
    // Canonical statuses plus legacy/raw whatsmeow receipt values.
    status:
      | ""
      | "sender"
      | "sent"
      | "delivered"
      | "read"
      | "played"
      | "read-self"
      | "played-self"
      | "inactive";
    timestamp: string;
  };
}

// Send confirmation event
export interface SendConfirmationEvent extends WhatsAppEvent {
  type: "send_confirmation";
  payload: {
    pendingMessageId: string;
    messageId: string;
    timestamp: string;
    correlationId?: string; // For end-to-end message flow tracing
  };
}

// Status update event
export interface StatusEvent extends WhatsAppEvent {
  type: "status";
  payload: {
    statusId: string;
    fromJid: string;
    mediaType: string | null;
    mediaUrl: string | null;
    caption: string | null;
    timestamp: string;
    expiresAt: string;
  };
}

// Contact sync event
export interface ContactEvent extends WhatsAppEvent {
  type: "contact";
  payload: {
    jid: string;
    name?: string;
    displayName?: string;
    firstName?: string;
    fullName?: string;
    pushName?: string;
    businessName?: string;
    isGroup?: boolean;
    nameOnly?: boolean;
    unreadCount?: number;
    participants?: Array<{
      jid: string;
      isAdmin: boolean;
    }>;
    participantCount?: number;
    profilePictureUrl?: string;
  };
}

// Presence (online/offline) event
export interface PresenceEvent extends WhatsAppEvent {
  type: "presence";
  payload: {
    from: string; // JID of the contact
    unavailable: boolean; // true = offline, false = online
    lastSeen?: string; // ISO 8601 timestamp when contact was last seen (only when going offline)
  };
}

// Typing indicator event
export interface TypingEvent extends WhatsAppEvent {
  type: "typing";
  payload: {
    from: string; // JID of the contact who is typing
    chatJid: string; // JID of the chat where typing occurs
    isTyping: boolean; // true = composing, false = paused
    mediaType?: string; // "text" or "audio"
  };
}

// Reaction event
export interface ReactionEvent extends WhatsAppEvent {
  type: "reaction";
  payload: {
    messageId: string; // ID of the message being reacted to
    from: string; // JID of the user who reacted
    chatJid: string; // JID of the chat
    emoji: string; // Reaction emoji (empty string means removed)
    timestamp: string;
  };
}

// Download response event
export interface DownloadResponseEvent extends WhatsAppEvent {
  type: "download_response";
  payload: {
    messageId: string;
    mediaUrl?: string;
    mediaSize?: number;
    success: boolean;
    error?: string;
  };
}

// Sync status event
export interface SyncStatusEvent extends WhatsAppEvent {
  type: "sync_status";
  payload: {
    status: "starting" | "progress" | "completed";
    messageCount: number;
    conversations: number;
  };
}

// Send failed event (message failed after max retries)
export interface SendFailedEvent extends WhatsAppEvent {
  type: "send_failed";
  payload: {
    pendingMessageId: string;
    reason: string;
    correlationId?: string; // For end-to-end message flow tracing
  };
}

export interface CommandResultEvent extends WhatsAppEvent {
  type: "command_result";
  payload: {
    commandId: string;
    commandType: string;
    success: boolean;
    error?: string;
  };
}

// Worker connection status event (from orchestrator)
export interface WorkerConnectionStatusEvent extends WhatsAppEvent {
  type: "connection_status";
  payload: {
    status: "error" | "failed" | "connecting" | "connected";
    reason: string;
  };
}
