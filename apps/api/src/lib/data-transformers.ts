/**
 * Data transformation utilities for converting database records to API response format.
 *
 * These transformers ensure consistent field mapping (snake_case to camelCase)
 * and provide a single source of truth for response shapes.
 */

import {
  extractPhoneFromJid,
  getContactDisplayName,
  getContactName,
} from "@wateaminbox/shared";

// ============================================================================
// Contact Types
// ============================================================================

/**
 * Raw contact data from database query.
 * Properties use snake_case to match database columns.
 */
export interface RawContactFromDb {
  id: string;
  jid: string;
  phone_number: string | null;
  push_name: string | null;
  custom_name: string | null;
  is_group: boolean;
  is_blocked?: boolean;
  profile_picture_url: string | null;
  notes_shared: string | null;
  last_message_at: Date | string | null;
  unread_count?: number | bigint | string;
  assigned_to: string | null;
  is_online?: boolean | null;
  last_seen?: Date | string | null;
  connection_id?: string | null;
  connection_name?: string | null;
  connection_phone_number?: string | null;
  connection_status?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  conversation_status?: "open" | "pending" | "resolved";
  active_case_id?: string | null;
  // Optional: last message data (from joined query)
  last_message?: {
    id: string;
    messageId: string;
    fromMe: boolean;
    sentByUserId?: string | null;
    sentByUserName?: string | null;
    messageType: string;
    content: string | null;
    status: string;
    timestamp: Date | string;
  } | null;
}

/**
 * Transformed contact for API response.
 * Properties use camelCase for frontend consumption.
 */
export interface TransformedContact {
  id: string;
  jid: string;
  phoneNumber: string | null;
  pushName: string | null;
  customName: string | null;
  displayName: string;
  name: string;
  isGroup: boolean;
  isBlocked: boolean;
  profilePictureUrl: string | null;
  notesShared: string | null;
  lastMessageAt: Date | string | null;
  lastMessage: {
    id: string;
    messageId: string;
    fromMe: boolean;
    sentByUserId: string | null;
    sentByUserName: string | null;
    messageType: string;
    content: string | null;
    status: string;
    timestamp: Date | string;
  } | null;
  connection: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    status: string;
  } | null;
  unreadCount: number;
  assignedTo: string | null;
  isOnline: boolean | null;
  lastSeen: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  conversationStatus: "open" | "pending" | "resolved";
  activeCaseId: string | null;
}

// ============================================================================
// Contact Transformers
// ============================================================================

export function getContactPhoneNumber(contact: {
  is_group: boolean;
  phone_number: string | null;
  jid: string;
}): string | null {
  if (contact.is_group) return null;
  const phoneFromJid = extractPhoneFromJid(contact.jid);
  if (!phoneFromJid) return null;
  return contact.phone_number || phoneFromJid;
}

/**
 * Transform a raw database contact record to API response format.
 *
 * Handles:
 * - snake_case to camelCase conversion
 * - Phone number extraction from JID if not stored
 * - Display name calculation using shared utilities
 * - Unread count type normalization (bigint/string to number)
 *
 * @example
 * ```ts
 * const contacts = await db.selectFrom("contacts").selectAll().execute();
 * return c.json({
 *   data: contacts.map(transformContact)
 * });
 * ```
 *
 * @param contact - Raw contact from database
 * @returns Transformed contact for API response
 */
export function transformContact(
  contact: RawContactFromDb,
): TransformedContact {
  return {
    id: contact.id,
    jid: contact.jid,
    phoneNumber: getContactPhoneNumber(contact),
    pushName: contact.push_name,
    customName: contact.custom_name,
    displayName: getContactDisplayName(contact),
    name: getContactName(contact) ?? getContactDisplayName(contact),
    isGroup: contact.is_group,
    isBlocked: contact.is_blocked ?? false,
    profilePictureUrl: contact.profile_picture_url,
    notesShared: contact.notes_shared,
    lastMessageAt: contact.last_message_at,
    lastMessage: contact.last_message
      ? {
          id: contact.last_message.id,
          messageId: contact.last_message.messageId,
          fromMe: contact.last_message.fromMe,
          sentByUserId: contact.last_message.sentByUserId ?? null,
          sentByUserName: contact.last_message.sentByUserName ?? null,
          messageType: contact.last_message.messageType,
          content: contact.last_message.content,
          status: contact.last_message.status,
          timestamp: contact.last_message.timestamp,
        }
      : null,
    connection: contact.connection_id
      ? {
          id: contact.connection_id,
          name: contact.connection_name ?? null,
          phoneNumber: contact.connection_phone_number ?? null,
          status: contact.connection_status || "disconnected",
        }
      : null,
    unreadCount: Number(contact.unread_count ?? 0),
    assignedTo: contact.assigned_to,
    isOnline: contact.is_online ?? null,
    lastSeen: contact.last_seen ?? null,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    conversationStatus: contact.conversation_status ?? "resolved",
    activeCaseId: contact.active_case_id ?? null,
  };
}

/**
 * Transform multiple contacts in one call.
 *
 * @example
 * ```ts
 * const { contacts, total } = await getContactsWithLastMessage(tenantDb, options);
 * return c.json({
 *   data: transformContacts(contacts),
 *   pagination: createPaginationMeta(total, contacts.length, { limit, offset })
 * });
 * ```
 *
 * @param contacts - Array of raw contacts from database
 * @returns Array of transformed contacts
 */
export function transformContacts(
  contacts: RawContactFromDb[],
): TransformedContact[] {
  return contacts.map(transformContact);
}

// ============================================================================
// Audit Log Types
// ============================================================================

/**
 * Raw audit log from service layer.
 * Note: The audit service already returns camelCase, so minimal transformation needed.
 */
export interface RawAuditLog {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date | string;
  actor: { id: string; name: string | null; email: string } | null;
}

/**
 * Transformed audit log for API response.
 */
export interface TransformedAuditLog {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date | string;
  actor: { id: string; name: string | null; email: string } | null;
}

// ============================================================================
// Audit Log Transformers
// ============================================================================

/**
 * Transform an audit log for API response.
 *
 * Currently a pass-through since audit service returns camelCase,
 * but provides a consistent transformation layer for future changes.
 *
 * @example
 * ```ts
 * const result = await auditService.getAuditLogs(options);
 * return c.json({
 *   data: result.logs.map(transformAuditLog)
 * });
 * ```
 *
 * @param log - Raw audit log from service
 * @returns Transformed audit log for API response
 */
export function transformAuditLog(log: RawAuditLog): TransformedAuditLog {
  return {
    id: log.id,
    userId: log.userId,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    details: log.details,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt,
    actor: log.actor,
  };
}

/**
 * Transform multiple audit logs in one call.
 *
 * @param logs - Array of raw audit logs from service
 * @returns Array of transformed audit logs
 */
export function transformAuditLogs(logs: RawAuditLog[]): TransformedAuditLog[] {
  return logs.map(transformAuditLog);
}
