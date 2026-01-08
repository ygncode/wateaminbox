import { normalizePhoneNumber as sharedNormalizePhoneNumber } from '../../lib/schemas.js'
import type { ContactImportRow } from './types.js'

/**
 * Normalize phone number to WhatsApp JID format
 *
 * @remarks
 * Strips all non-digit characters (except +), removes leading + or 00,
 * and formats the number for WhatsApp messaging.
 *
 * The JID (Jabber ID) format is required by WhatsApp's internal protocol.
 * This is a re-export from lib/schemas.ts for backward compatibility.
 *
 * @param phone - Phone number in any format
 * @returns Object containing the JID and cleaned phone number
 *
 * @example
 * ```ts
 * normalizePhoneNumber('+1 (234) 567-8900')
 * // => { jid: '12345678900@s.whatsapp.net', phoneNumber: '12345678900' }
 * ```
 */
export function normalizePhoneNumber(phone: string): {
  /** WhatsApp JID format for messaging */
  jid: string
  /** Cleaned phone number (digits only) */
  phoneNumber: string
} {
  const result = sharedNormalizePhoneNumber(phone)
  return {
    jid: result.jid,
    phoneNumber: result.cleanedPhone,
  }
}

/**
 * Map CSV row to contact import row
 *
 * @remarks
 * Handles flexible column naming conventions. Searches for phone number,
 * name, notes, and tags across various common column names.
 *
 * Supported phone number columns: phone_number, phone, phonenumber, mobile, cell, whatsapp, number
 * Supported name columns: custom_name, name, full_name, fullname, display_name, displayname, contact_name
 * Supported notes columns: notes, note, shared_notes, description
 * Supported tag columns: tags, tag, labels, label
 *
 * @param row - A parsed CSV row object
 * @returns ContactImportRow or null if no phone number is found
 *
 * @example
 * ```ts
 * mapToContactRow({ phone: '+1234567890', Name: 'John Doe', Tags: 'VIP,Lead' })
 * // => { phone_number: '+1234567890', custom_name: 'John Doe', tags: 'VIP,Lead' }
 * ```
 */
export function mapToContactRow(row: Record<string, string>): ContactImportRow | null {
  // Look for phone number in various column names
  const phoneNumber =
    row.phone_number ||
    row.phone ||
    row.phonenumber ||
    row.mobile ||
    row.cell ||
    row.whatsapp ||
    row.number ||
    ''

  if (!phoneNumber) return null

  // Look for name in various column names
  const customName =
    row.custom_name ||
    row.name ||
    row.full_name ||
    row.fullname ||
    row.display_name ||
    row.displayname ||
    row.contact_name ||
    ''

  // Look for notes
  const notes = row.notes || row.note || row.shared_notes || row.description || ''

  // Look for tags
  const tags = row.tags || row.tag || row.labels || row.label || ''

  return {
    phone_number: phoneNumber,
    custom_name: customName || undefined,
    notes: notes || undefined,
    tags: tags || undefined,
  }
}
