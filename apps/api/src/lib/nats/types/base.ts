/**
 * NATS Base Types
 * Core type definitions and constants for NATS communication
 */

// NATS Subjects/Topics - Must match orchestrator subjects
// Updated to support connectionId routing for multi-connection support
export const NATS_SUBJECTS = {
  // Commands to WhatsApp worker (uppercase to match orchestrator)
  // Format: WHATSAPP.commands.{companyId}.{connectionId}
  WHATSAPP_COMMANDS: "WHATSAPP.commands",
  WHATSAPP_SPAWN: "WHATSAPP.commands",
  WHATSAPP_KILL: "WHATSAPP.commands",
  WHATSAPP_SEND: "WHATSAPP.commands",

  // Events from WhatsApp worker
  // Format: WHATSAPP.events.{companyId}.{connectionId}.{eventType}
  WHATSAPP_EVENTS: "WHATSAPP.events",
  WHATSAPP_QR: "WHATSAPP.events",
  WHATSAPP_CONNECTION: "WHATSAPP.events",
  WHATSAPP_MESSAGE: "WHATSAPP.events",
  WHATSAPP_RECEIPT: "WHATSAPP.events",
} as const;

// Message type discriminator for commands
export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction"
  | "template";

// Status type discriminator
export type StatusType = "text" | "image" | "video";

// Base command interface (snake_case to match Go orchestrator)
export interface NatsCommand {
  type:
    | "spawn"
    | "kill"
    | "send"
    | "post_status"
    | "group_create"
    | "group_add_participants"
    | "group_remove_participants"
    | "group_promote_admin"
    | "group_demote_admin"
    | "group_update_settings"
    | "group_leave"
    | "group_invite_link"
    | "group_join_requests_fetch"
    | "group_join_requests_update"
    | "group_sync"
    | "sync_labels"
    | "apply_label"
    | "remove_label"
    | "sync_catalogs"
    | "sync_catalog_products"
    | "block_contact"
    | "unblock_contact"
    | "fetch_profile_picture"
    | "request_history";
  company_id: string;
  connection_id: string;
  timestamp?: string;
}

// Base event interface
export interface WhatsAppEvent {
  contractVersion: 1;
  type:
    | "qr"
    | "paired"
    | "connected"
    | "disconnected"
    | "logged_out"
    | "message"
    | "receipt"
    | "send_confirmation"
    | "send_failed"
    | "status"
    | "contact"
    | "labels"
    | "catalogs"
    | "catalog_products"
    | "profile_picture"
    | "message_revoke"
    | "presence"
    | "typing"
    | "reaction"
    | "sync_status"
    | "history_sync_page"
    | "download_response"
    | "connection_status"
    | "command_result"
    | "group"
    | "error";
  companyId: string;
  connectionId: string;
  /** Internal API-only field populated after resolving the worker session. */
  sessionId?: string;
  payload: unknown;
  timestamp: string;
  correlationId?: string; // For end-to-end message flow tracing
}
