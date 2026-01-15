/**
 * NATS Command Types
 * Command interfaces for WhatsApp worker communication
 */

import type { NatsCommand, MessageType, StatusType } from "./base.js";

// Spawn command to start WhatsApp connection
export interface SpawnCommand extends NatsCommand {
  type: "spawn";
  tenant_schema: string;
  database_url: string;
}

// Kill command to disconnect WhatsApp
export interface KillCommand extends NatsCommand {
  type: "kill";
  reason?: string;
}

// Send message command
export interface SendMessageCommand extends NatsCommand {
  type: "send";
  jid: string;
  content: string;
  message_type: MessageType;
  media_url?: string;
  user_id: string;
}

// Post status command
export interface PostStatusCommand extends NatsCommand {
  type: "post_status";
  status_type: StatusType;
  content?: string; // Text content or caption
  media_url?: string; // URL of uploaded media
  user_id: string;
}

// Group admin action commands
export interface GroupPromoteAdminCommand extends NatsCommand {
  type: "group_promote_admin";
  group_jid: string;
  participant_jid: string;
  user_id: string;
}

export interface GroupDemoteAdminCommand extends NatsCommand {
  type: "group_demote_admin";
  group_jid: string;
  participant_jid: string;
  user_id: string;
}

export interface GroupRemoveParticipantCommand extends NatsCommand {
  type: "group_remove_participant";
  group_jid: string;
  participant_jid: string;
  user_id: string;
}

export interface GroupUpdateSettingsCommand extends NatsCommand {
  type: "group_update_settings";
  group_jid: string;
  name?: string;
  description?: string;
  user_id: string;
}

// Label sync commands
export interface SyncLabelsCommand extends NatsCommand {
  type: "sync_labels";
  user_id: string;
}

export interface ApplyLabelCommand extends NatsCommand {
  type: "apply_label";
  label_id: string;
  contact_jid: string;
  user_id: string;
}

export interface RemoveLabelCommand extends NatsCommand {
  type: "remove_label";
  label_id: string;
  contact_jid: string;
  user_id: string;
}

// Catalog sync commands
export interface SyncCatalogsCommand extends NatsCommand {
  type: "sync_catalogs";
  user_id: string;
}

export interface SyncCatalogProductsCommand extends NatsCommand {
  type: "sync_catalog_products";
  catalog_id: string;
  user_id: string;
}

// Block contact command
export interface BlockContactCommand extends NatsCommand {
  type: "block_contact";
  contact_jid: string;
}

// Unblock contact command
export interface UnblockContactCommand extends NatsCommand {
  type: "unblock_contact";
  contact_jid: string;
}
