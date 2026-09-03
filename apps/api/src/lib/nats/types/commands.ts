/**
 * NATS Command Types
 * Command interfaces for WhatsApp worker communication
 */

import type { MessageType, NatsCommand, StatusType } from "./base.js";

// Spawn command to start WhatsApp connection
export interface SpawnCommand extends NatsCommand {
  type: "spawn";
  tenant_schema: string;
}

// Kill command to disconnect WhatsApp
export interface KillCommand extends NatsCommand {
  type: "kill";
  tenant_schema: string;
  reason?: string;
  unlink?: boolean;
}

// Send message command
export interface SendMessageCommand extends NatsCommand {
  type: "send";
  jid: string;
  content: string;
  message_type: MessageType;
  media_object_key?: string;
  media_size?: number;
  media_checksum?: string;
  mime_type?: string;
  file_name?: string;
  mentioned_jids?: string[];
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

/**
 * Group administration commands.
 *
 * None of these carry the resulting state: the worker executes the request and
 * then publishes what WhatsApp actually reports back (a `group` event), which
 * is the only thing the API persists. There is deliberately no delete/disband
 * command - WhatsApp has no such operation; `group_leave` ends this account's
 * membership and leaves the group intact for everyone else.
 */
export interface GroupCreateCommand extends NatsCommand {
  type: "group_create";
  name: string;
  /** Initial members. The connected account is added by WhatsApp implicitly. */
  participant_jids: string[];
  user_id: string;
}

/** Participants a command acts on, always as a list even for a single member. */
interface GroupParticipantsCommand extends NatsCommand {
  group_jid: string;
  participant_jids: string[];
  user_id: string;
}

export interface GroupAddParticipantsCommand extends GroupParticipantsCommand {
  type: "group_add_participants";
}

export interface GroupRemoveParticipantsCommand
  extends GroupParticipantsCommand {
  type: "group_remove_participants";
}

export interface GroupPromoteAdminCommand extends GroupParticipantsCommand {
  type: "group_promote_admin";
}

export interface GroupDemoteAdminCommand extends GroupParticipantsCommand {
  type: "group_demote_admin";
}

/**
 * Group profile and permission changes. An omitted field is left untouched -
 * WhatsApp needs one request per setting, so the worker only sends the ones
 * that are present.
 */
export interface GroupUpdateSettingsCommand extends NatsCommand {
  type: "group_update_settings";
  group_jid: string;
  name?: string;
  description?: string;
  /** Only admins may send messages. */
  is_announce?: boolean;
  /** Only admins may edit the group's name, icon and description. */
  is_locked?: boolean;
  /** New members must be approved by an admin. */
  is_join_approval_required?: boolean;
  /** `admin_add` or `all_member_add`. */
  member_add_mode?: string;
  user_id: string;
}

export interface GroupLeaveCommand extends NatsCommand {
  type: "group_leave";
  group_jid: string;
  user_id: string;
}

export interface GroupInviteLinkCommand extends NatsCommand {
  type: "group_invite_link";
  group_jid: string;
  /** Revoke the current link before returning a new one. */
  reset: boolean;
  user_id: string;
}

export interface GroupJoinRequestsFetchCommand extends NatsCommand {
  type: "group_join_requests_fetch";
  group_jid: string;
  user_id: string;
}

export interface GroupJoinRequestsUpdateCommand extends NatsCommand {
  type: "group_join_requests_update";
  group_jid: string;
  participant_jids: string[];
  decision: "approve" | "reject";
  user_id: string;
}

/** Re-read a group from WhatsApp without changing anything. */
export interface GroupSyncCommand extends NatsCommand {
  type: "group_sync";
  group_jid: string;
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

export interface RequestHistoryCommand extends NatsCommand {
  type: "request_history";
  chat_jid: string;
  oldest_message_id: string;
  oldest_from_me: boolean;
  oldest_timestamp: string;
  count: number;
}
