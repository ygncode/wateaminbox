import type { ColumnType } from "kysely";

export type CompanyStatus = "active" | "deleted" | "suspended";

export type ConversationStatus = "open" | "pending" | "resolved";

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

export type NotificationType = "assignment" | "mention" | "message" | "system" | "team";

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

export interface TenantCd7a2616E94d412198af4a662d2633bfContactAssignments {
  assigned_at: Generated<Timestamp>;
  assigned_by: string;
  assigned_to: string;
  contact_id: string;
  id: Generated<string>;
  unassigned_at: Timestamp | null;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfContactLabels {
  contact_id: string;
  label_id: string;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfContactNotesShared {
  author_name: string;
  contact_id: string;
  content: string;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  updated_at: Generated<Timestamp>;
  user_id: string;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfContacts {
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

export interface TenantCd7a2616E94d412198af4a662d2633bfContactTags {
  contact_id: string;
  tag_id: string;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfConversationStates {
  contact_id: string;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  state: Generated<ConversationStatus>;
  updated_at: Generated<Timestamp>;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfMessages {
  contact_id: string;
  content: string | null;
  created_at: Generated<Timestamp>;
  from_me: Generated<boolean | null>;
  id: Generated<string>;
  message_id: string | null;
  metadata: Json | null;
  status: Generated<MessageStatus | null>;
  timestamp: Generated<Timestamp>;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfNotificationHistory {
  acknowledged_at: Timestamp | null;
  contact_id: string;
  id: Generated<string>;
  message_id: string;
  notification_type: NotificationType;
  sent_at: Generated<Timestamp>;
  sent_to: string;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfQuickReplies {
  content: string;
  created_at: Generated<Timestamp>;
  created_by: string;
  id: Generated<string>;
  shortcut: string;
  updated_at: Generated<Timestamp>;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfTags {
  color: string | null;
  created_at: Generated<Timestamp>;
  created_by: string | null;
  id: Generated<string>;
  name: string;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfWhatsappCatalogs {
  catalog_id: string;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  is_default: Generated<boolean | null>;
  name: string;
  updated_at: Generated<Timestamp>;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfWhatsappConnections {
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

export interface TenantCd7a2616E94d412198af4a662d2633bfWhatsappLabels {
  color: string | null;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  label_id: string;
  name: string;
  updated_at: Generated<Timestamp>;
}

export interface TenantCd7a2616E94d412198af4a662d2633bfWhatsappProducts {
  catalog_id: string;
  created_at: Generated<Timestamp>;
  currency: string | null;
  description: string | null;
  id: Generated<string>;
  image_url: string | null;
  name: string;
  price: Numeric | null;
  product_id: string;
  updated_at: Generated<Timestamp>;
  url: string | null;
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
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.contact_assignments": TenantCd7a2616E94d412198af4a662d2633bfContactAssignments;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.contact_labels": TenantCd7a2616E94d412198af4a662d2633bfContactLabels;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.contact_notes_shared": TenantCd7a2616E94d412198af4a662d2633bfContactNotesShared;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.contact_tags": TenantCd7a2616E94d412198af4a662d2633bfContactTags;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.contacts": TenantCd7a2616E94d412198af4a662d2633bfContacts;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.conversation_states": TenantCd7a2616E94d412198af4a662d2633bfConversationStates;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.messages": TenantCd7a2616E94d412198af4a662d2633bfMessages;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.notification_history": TenantCd7a2616E94d412198af4a662d2633bfNotificationHistory;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.quick_replies": TenantCd7a2616E94d412198af4a662d2633bfQuickReplies;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.tags": TenantCd7a2616E94d412198af4a662d2633bfTags;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.whatsapp_catalogs": TenantCd7a2616E94d412198af4a662d2633bfWhatsappCatalogs;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.whatsapp_connections": TenantCd7a2616E94d412198af4a662d2633bfWhatsappConnections;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.whatsapp_labels": TenantCd7a2616E94d412198af4a662d2633bfWhatsappLabels;
  "tenant_cd7a2616_e94d_4121_98af_4a662d2633bf.whatsapp_products": TenantCd7a2616E94d412198af4a662d2633bfWhatsappProducts;
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
