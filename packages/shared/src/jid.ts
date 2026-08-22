/**
 * JID (Jabber ID) utilities for WhatsApp
 *
 * JID formats:
 * - Individual: {phone}@s.whatsapp.net
 * - Group: {group_id}@g.us
 * - Broadcast: status@broadcast
 */

/**
 * Extract phone number from a JID, handling device suffix
 *
 * @param jid - WhatsApp JID (e.g., "1234567890@s.whatsapp.net" or "1234567890:3@s.whatsapp.net")
 * @returns Phone number (cleaned, digits only) or null if invalid
 */
export function extractPhoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null

  const [userPart, server, ...extraParts] = jid.trim().split('@')
  // Only WhatsApp's phone-number namespace contains a phone number. LID,
  // hosted-LID, group, newsletter, and broadcast local parts are opaque IDs
  // even when they happen to contain only digits.
  if (!userPart || server !== 's.whatsapp.net' || extraParts.length > 0) {
    return null
  }

  // Remove device suffix (the :N part, e.g., ":3")
  const phone = userPart.split(':')[0]

  // Clean the phone number: remove all non-digit characters
  // This handles cases where WhatsApp sends JIDs with spaces or special chars
  // e.g., "445781 3665 799 0@s.whatsapp.net" becomes "445781366579990"
  const cleanedPhone = phone.replace(/\D/g, '')

  return cleanedPhone || null
}

/**
 * Extract group ID from a group JID
 *
 * @param jid - WhatsApp group JID (e.g., "123456789-1234567890@g.us")
 * @returns Group ID or null if invalid
 */
export function extractGroupIdFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  const groupId = jid.split('@')[0]
  return groupId || null
}

/**
 * Check if a JID represents a group
 *
 * @param jid - WhatsApp JID
 * @returns true if group JID, false otherwise
 */
export function isGroupJid(jid: string | null | undefined): boolean {
  if (!jid) return false
  return jid.endsWith('@g.us')
}

/**
 * Check if a JID represents a broadcast
 *
 * @param jid - WhatsApp JID
 * @returns true if broadcast JID, false otherwise
 */
export function isBroadcastJid(jid: string | null | undefined): boolean {
  if (!jid) return false
  return jid === 'status@broadcast' || jid.endsWith('@broadcast')
}

/**
 * Check if a JID represents an individual contact
 *
 * @param jid - WhatsApp JID
 * @returns true if individual JID, false otherwise
 */
export function isIndividualJid(jid: string | null | undefined): boolean {
  if (!jid) return false
  return jid.endsWith('@s.whatsapp.net')
}

/** Check whether a JID is an opaque WhatsApp link-ID identity. */
export function isLidJid(jid: string | null | undefined): boolean {
  if (!jid) return false
  return jid.endsWith('@lid') || jid.endsWith('@hosted.lid')
}

/** Build a privacy-safe label that still distinguishes multiple LID contacts. */
export function getLidDisplayName(jid: string | null | undefined): string | null {
  if (!isLidJid(jid)) return null
  const localPart = jid?.split('@')[0]?.split(':')[0] ?? ''
  const suffix = localPart.slice(-4)
  return suffix ? `WhatsApp user (ID …${suffix})` : 'WhatsApp user'
}

/**
 * Create an individual JID from a phone number
 *
 * @param phone - Phone number (digits only, with country code)
 * @returns WhatsApp JID
 */
export function createIndividualJid(phone: string): string {
  // Remove any non-digit characters
  const cleanPhone = phone.replace(/\D/g, '')
  return `${cleanPhone}@s.whatsapp.net`
}

/**
 * Create a group JID from a group ID
 *
 * @param groupId - Group ID
 * @returns WhatsApp group JID
 */
export function createGroupJid(groupId: string): string {
  return `${groupId}@g.us`
}

/**
 * Normalize a JID (remove any device suffix)
 * Some JIDs have device suffixes like "1234567890:0@s.whatsapp.net"
 *
 * @param jid - WhatsApp JID
 * @returns Normalized JID without device suffix
 */
export function normalizeJid(jid: string | null | undefined): string | null {
  if (!jid) return null

  // Split by @ to get the local part and domain
  const parts = jid.split('@')
  if (parts.length !== 2) return jid

  // Remove device suffix from local part (e.g., "1234:0" -> "1234")
  const localPart = parts[0].split(':')[0]

  return `${localPart}@${parts[1]}`
}
