import type { ColumnType } from "kysely";

export type CompanyStatus = "active" | "deleted" | "suspended";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>;

export type Json = ColumnType<JsonValue, string, string>;

export type JsonArray = JsonValue[];

export type JsonObject = {
  [K in string]?: JsonValue;
};

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export type MemberRole = "admin" | "member" | "owner";

export type MessageStatus = "delivered" | "failed" | "pending" | "read" | "sent";

export type MessageType = "audio" | "contact" | "document" | "image" | "location" | "reaction" | "sticker" | "text" | "video";

export type Numeric = ColumnType<string, number | string, number | string>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type WhatsappConnectionStatus = "banned" | "connected" | "disconnected" | "pending";

export interface Companies {
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  max_whatsapp_connections: Generated<number>;
  name: string;
  schema_name: string;
  status: Generated<CompanyStatus>;
  updated_at: Generated<Timestamp>;
}

export interface CompanyMembers {
  company_id: string;
  id: Generated<string>;
  invited_by: string | null;
  joined_at: Generated<Timestamp>;
  permissions: Generated<Json | null>;
  role: Generated<MemberRole>;
  user_id: string;
}

export interface CompanyStats {
  active_users: Generated<number>;
  company_id: string;
  last_message_at: Timestamp | null;
  total_contacts: Generated<number>;
  total_messages: Generated<number>;
  updated_at: Generated<Timestamp>;
}

export interface Invitations {
  accepted_at: Timestamp | null;
  company_id: string;
  created_at: Generated<Timestamp>;
  email: string;
  expires_at: Timestamp;
  id: Generated<string>;
  invited_by: string;
  token: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cAuditLogs {
  action: string;
  created_at: Generated<Timestamp>;
  details: Json | null;
  entity_id: string | null;
  entity_type: string | null;
  id: Generated<string>;
  ip_address: string | null;
  user_id: string | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cCatalogProducts {
  availability: Generated<string | null>;
  catalog_id: string;
  created_at: Generated<Timestamp>;
  currency: Generated<string | null>;
  description: string | null;
  id: Generated<string>;
  image_url: string | null;
  name: string;
  price: Numeric | null;
  product_id: string;
  retailer_id: string | null;
  updated_at: Generated<Timestamp>;
  url: string | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContactAssignments {
  assigned_at: Generated<Timestamp>;
  assigned_by: string;
  assigned_to: string;
  contact_id: string;
  id: Generated<string>;
  unassigned_at: Timestamp | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContactNotesPrivate {
  contact_id: string;
  content: string | null;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  updated_at: Generated<Timestamp>;
  user_id: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContacts {
  created_at: Generated<Timestamp>;
  custom_name: string | null;
  id: Generated<string>;
  is_group: Generated<boolean | null>;
  is_online: Generated<boolean>;
  jid: string | null;
  last_seen: Timestamp | null;
  notes_shared: string | null;
  phone_number: string | null;
  profile_picture_url: string | null;
  push_name: string | null;
  updated_at: Generated<Timestamp>;
  whatsapp_connection_id: string | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContactTags {
  contact_id: string;
  tag_id: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cConversationStates {
  contact_id: string;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  last_message_at: Timestamp | null;
  last_message_preview: string | null;
  read_at: Timestamp | null;
  read_by_user_id: string | null;
  unread_count: Generated<number | null>;
  updated_at: Generated<Timestamp>;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cGroupParticipants {
  group_id: string;
  id: Generated<string>;
  is_admin: Generated<boolean | null>;
  joined_at: Generated<Timestamp>;
  participant_jid: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cGroups {
  contact_id: string | null;
  created_at: Generated<Timestamp>;
  created_by: string | null;
  description: string | null;
  id: Generated<string>;
  jid: string | null;
  name: string | null;
  participant_count: Generated<number | null>;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cMessageReactions {
  created_at: Generated<Timestamp>;
  emoji: string;
  id: Generated<string>;
  message_id: string;
  reactor_jid: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cMessages {
  contact_id: string | null;
  content: string | null;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  deleted_by_sender: Generated<boolean | null>;
  from_me: boolean;
  id: Generated<string>;
  is_forwarded: Generated<boolean | null>;
  is_starred: Generated<boolean | null>;
  media_mime_type: string | null;
  media_size: number | null;
  media_url: string | null;
  message_id: string | null;
  message_type: MessageType;
  metadata: Json | null;
  quoted_message_id: string | null;
  search_vector: string | null;
  sender_jid: string | null;
  sent_by_user_id: string | null;
  status: Generated<MessageStatus | null>;
  timestamp: Timestamp;
  whatsapp_connection_id: string | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cNotificationHistory {
  action_url: string | null;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  is_read: Generated<boolean | null>;
  message: string | null;
  metadata: Json | null;
  notification_type: string;
  read_at: Timestamp | null;
  title: string;
  user_id: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cNotificationPreferences {
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  muted_contacts: string[] | null;
  quiet_hours_end: string | null;
  quiet_hours_start: string | null;
  sound_choice: Generated<string | null>;
  sound_enabled: Generated<boolean | null>;
  updated_at: Generated<Timestamp>;
  user_id: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cQuickReplies {
  content: string;
  created_at: Generated<Timestamp>;
  created_by: string;
  id: Generated<string>;
  is_shared: Generated<boolean | null>;
  shortcut: string;
  updated_at: Generated<Timestamp>;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cStatusUpdates {
  caption: string | null;
  expires_at: Timestamp;
  from_jid: string | null;
  id: Generated<string>;
  media_type: string | null;
  media_url: string | null;
  status_id: string | null;
  timestamp: Timestamp;
  whatsapp_connection_id: string | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cTags {
  color: string | null;
  created_at: Generated<Timestamp>;
  created_by: string | null;
  id: Generated<string>;
  name: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappCatalogs {
  catalog_id: string;
  created_at: Generated<Timestamp>;
  description: string | null;
  id: Generated<string>;
  name: string | null;
  product_count: Generated<number | null>;
  synced_at: Timestamp | null;
  updated_at: Generated<Timestamp>;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappConnections {
  connected_at: Timestamp | null;
  connected_by: string | null;
  connection_order: Generated<number | null>;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  jid: string | null;
  last_sync_at: Timestamp | null;
  name: string | null;
  phone_number: string | null;
  status: Generated<WhatsappConnectionStatus>;
  updated_at: Generated<Timestamp>;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappLabelAssociations {
  contact_id: string | null;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  label_id: string;
  message_id: string | null;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappLabels {
  color: string | null;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  name: string;
  predefined_id: number | null;
  updated_at: Generated<Timestamp>;
  whatsapp_label_id: string;
}

export interface Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsmeowLidMappings {
  connection_id: string;
  created_at: Generated<Timestamp>;
  jid: string;
  lid: string;
}

export interface Users {
  created_at: Generated<Timestamp>;
  email: string;
  email_verified_at: Timestamp | null;
  id: Generated<string>;
  name: string | null;
  password_hash: string;
  updated_at: Generated<Timestamp>;
}

export interface UserSessions {
  created_at: Generated<Timestamp>;
  device_name: string | null;
  device_type: string | null;
  expires_at: Timestamp;
  id: Generated<string>;
  ip_address: string | null;
  last_active_at: Generated<Timestamp>;
  refresh_token: string;
  user_agent: string | null;
  user_id: string;
}

export interface WhatsappSessionsWhatsmeowAppStateMutationMacs {
  connection_id: string;
  index_mac: Buffer;
  jid: string;
  name: string;
  value_mac: Buffer;
  version: Int8;
}

export interface WhatsappSessionsWhatsmeowAppStateSyncKeys {
  connection_id: string;
  fingerprint: Buffer;
  jid: string;
  key_data: Buffer;
  key_id: Buffer;
  timestamp: Int8;
}

export interface WhatsappSessionsWhatsmeowAppStateVersion {
  connection_id: string;
  hash: Buffer;
  jid: string;
  name: string;
  version: Int8;
}

export interface WhatsappSessionsWhatsmeowChatSettings {
  archived: Generated<boolean>;
  chat_jid: string;
  connection_id: string;
  muted_until: Generated<Int8>;
  our_jid: string;
  pinned: Generated<boolean>;
}

export interface WhatsappSessionsWhatsmeowContacts {
  business_name: string | null;
  connection_id: string;
  first_name: string | null;
  full_name: string | null;
  our_jid: string;
  push_name: string | null;
  their_jid: string;
}

export interface WhatsappSessionsWhatsmeowDevice {
  adv_account_sig: Buffer;
  adv_details: Buffer;
  adv_device_sig: Buffer;
  adv_key: Buffer;
  business_name: Generated<string>;
  connection_id: string;
  facebook_uuid: string | null;
  identity_key: Buffer;
  jid: string;
  noise_key: Buffer;
  platform: Generated<string>;
  push_name: Generated<string>;
  registration_id: Int8;
  signed_pre_key: Buffer;
  signed_pre_key_id: number;
  signed_pre_key_sig: Buffer;
}

export interface WhatsappSessionsWhatsmeowIdentityKeys {
  connection_id: string;
  identity: Buffer;
  our_jid: string;
  their_id: string;
}

export interface WhatsappSessionsWhatsmeowLidMappings {
  connection_id: string;
  created_at: Generated<Timestamp>;
  jid: string;
  lid: string;
}

export interface WhatsappSessionsWhatsmeowMessageSecrets {
  chat_jid: string;
  connection_id: string;
  message_id: string;
  our_jid: string;
  secret: Buffer;
  sender_jid: string;
}

export interface WhatsappSessionsWhatsmeowPreKeys {
  connection_id: string;
  jid: string;
  key: Buffer;
  key_id: number;
  uploaded: Generated<boolean>;
}

export interface WhatsappSessionsWhatsmeowPrivacyTokens {
  connection_id: string;
  our_jid: string;
  timestamp: Int8;
  token: Buffer;
  user_jid: string;
}

export interface WhatsappSessionsWhatsmeowSenderKeys {
  chat_id: string;
  connection_id: string;
  our_jid: string;
  sender_id: string;
  sender_key: Buffer;
}

export interface WhatsappSessionsWhatsmeowSessions {
  connection_id: string;
  our_jid: string;
  session: Buffer;
  their_id: string;
}

export interface WhatsappSessionsWhatsmeowVersion {
  connection_id: string;
  version: number;
}

export interface DB {
  companies: Companies;
  company_members: CompanyMembers;
  company_stats: CompanyStats;
  invitations: Invitations;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.audit_logs": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cAuditLogs;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.catalog_products": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cCatalogProducts;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.contact_assignments": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContactAssignments;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.contact_notes_private": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContactNotesPrivate;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.contact_tags": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContactTags;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.contacts": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cContacts;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.conversation_states": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cConversationStates;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.group_participants": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cGroupParticipants;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.groups": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cGroups;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.message_reactions": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cMessageReactions;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.messages": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cMessages;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.notification_history": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cNotificationHistory;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.notification_preferences": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cNotificationPreferences;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.quick_replies": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cQuickReplies;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.status_updates": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cStatusUpdates;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.tags": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cTags;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.whatsapp_catalogs": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappCatalogs;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.whatsapp_connections": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappConnections;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.whatsapp_label_associations": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappLabelAssociations;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.whatsapp_labels": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsappLabels;
  "tenant_6b1c9257_f4dc_4e8c_aef2_da6afd386a7c.whatsmeow_lid_mappings": Tenant6b1c9257F4dc4e8cAef2Da6afd386a7cWhatsmeowLidMappings;
  user_sessions: UserSessions;
  users: Users;
  "whatsapp_sessions.whatsmeow_app_state_mutation_macs": WhatsappSessionsWhatsmeowAppStateMutationMacs;
  "whatsapp_sessions.whatsmeow_app_state_sync_keys": WhatsappSessionsWhatsmeowAppStateSyncKeys;
  "whatsapp_sessions.whatsmeow_app_state_version": WhatsappSessionsWhatsmeowAppStateVersion;
  "whatsapp_sessions.whatsmeow_chat_settings": WhatsappSessionsWhatsmeowChatSettings;
  "whatsapp_sessions.whatsmeow_contacts": WhatsappSessionsWhatsmeowContacts;
  "whatsapp_sessions.whatsmeow_device": WhatsappSessionsWhatsmeowDevice;
  "whatsapp_sessions.whatsmeow_identity_keys": WhatsappSessionsWhatsmeowIdentityKeys;
  "whatsapp_sessions.whatsmeow_lid_mappings": WhatsappSessionsWhatsmeowLidMappings;
  "whatsapp_sessions.whatsmeow_message_secrets": WhatsappSessionsWhatsmeowMessageSecrets;
  "whatsapp_sessions.whatsmeow_pre_keys": WhatsappSessionsWhatsmeowPreKeys;
  "whatsapp_sessions.whatsmeow_privacy_tokens": WhatsappSessionsWhatsmeowPrivacyTokens;
  "whatsapp_sessions.whatsmeow_sender_keys": WhatsappSessionsWhatsmeowSenderKeys;
  "whatsapp_sessions.whatsmeow_sessions": WhatsappSessionsWhatsmeowSessions;
  "whatsapp_sessions.whatsmeow_version": WhatsappSessionsWhatsmeowVersion;
}
