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
    protocolSenderJid?: string;
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
    description?: string;
    firstName?: string;
    fullName?: string;
    pushName?: string;
    username?: string | null;
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

export interface HistorySyncPageEvent extends WhatsAppEvent {
  type: "history_sync_page";
  payload: {
    chatJid: string;
    messageCount: number;
    status: "unknown" | "available" | "exhausted" | "unavailable";
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

/**
 * What happened to a command, beyond whether everything went right.
 *
 * `applied_not_synced` is the case `success: false` alone cannot express: the
 * change DID take effect on WhatsApp and only the read-back failed. Presenting
 * that as a failure invites the user to repeat an action that already happened.
 */
export type CommandOutcome = "succeeded" | "failed" | "applied_not_synced";

export interface CommandResultEvent extends WhatsAppEvent {
  type: "command_result";
  payload: {
    commandId: string;
    commandType: string;
    success: boolean;
    /** Absent on events from workers deployed before outcomes existed. */
    outcome?: CommandOutcome;
    error?: string;
  };
}

/**
 * WhatsApp's own description of a group, as reported by the worker.
 *
 * Every field is optional because a change notification only names what
 * changed. An absent field means "WhatsApp did not report this", which must be
 * preserved rather than defaulted - resetting a permission the server never
 * mentioned would silently rewrite group state the workspace does not own.
 */
export interface GroupSnapshotPayload {
  jid: string;
  name?: string;
  description?: string;
  ownerJid?: string;
  participants?: Array<{ jid: string; isAdmin: boolean }>;
  participantCount?: number;
  isAnnounce?: boolean;
  isLocked?: boolean;
  isEphemeral?: boolean;
  disappearingTimer?: number;
  isJoinApprovalRequired?: boolean;
  memberAddMode?: string;
  isMember?: boolean;
}

/**
 * Group administration event.
 *
 * `left` records that the connected account is no longer a member. WhatsApp has
 * no delete/disband operation, so this never means the group ceased to exist.
 */
export interface GroupEvent extends WhatsAppEvent {
  type: "group";
  payload: {
    action: "snapshot" | "created" | "left" | "invite_link" | "join_requests";
    jid: string;
    /** Outbox id of the command that asked for this, when there was one. */
    commandId?: string;
    snapshot?: GroupSnapshotPayload;
    inviteLink?: string;
    joinRequests?: Array<{ jid: string; requestedAt?: string }>;
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
