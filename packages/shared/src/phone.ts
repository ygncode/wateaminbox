import { extractPhoneFromJid, getLidDisplayName } from './jid'

/**
 * Phone number utilities
 */

/**
 * Format a WhatsApp phone number in E.164-style display form.
 * WhatsApp identities contain country-code digits, so every non-empty number
 * must have a `+` prefix regardless of its digit count.
 */
export function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return ''
  const cleanPhone = phone.replace(/\D/g, '')
  return cleanPhone ? `+${cleanPhone}` : ''
}

/**
 * Format a value that may be a name, numeric fallback, or individual JID.
 * Real names and non-individual JIDs are preserved.
 */
export function formatPhoneLikeText(
  value: string | null | undefined,
): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  const lidDisplayName = getLidDisplayName(trimmed)
  if (lidDisplayName) return lidDisplayName

  if (trimmed.endsWith('@s.whatsapp.net')) {
    return formatPhoneNumber(parsePhoneFromJid(trimmed))
  }

  const digits = trimmed.replace(/\D/g, '')
  const isPhoneLike =
    /^[+\d][\d\s().-]*$/.test(trimmed) &&
    digits.length >= 7 &&
    digits.length <= 15
  return isPhoneLike ? formatPhoneNumber(digits) : trimmed
}

/**
 * Format a phone number with grouping for better readability
 * Uses common international grouping patterns
 *
 * @param phone - Phone number (digits only)
 * @returns Phone number with spaces for readability
 *
 * @example
 * ```ts
 * formatPhoneNumberWithGroups("11234567890")  // "+1 123 456 7890"
 * formatPhoneNumberWithGroups("441onal23456789") // "+44 7123 456 789"
 * ```
 */
export function formatPhoneNumberWithGroups(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '')

  // Keep the international marker even when grouping is not useful.
  if (cleanPhone.length < 7) {
    return formatPhoneNumber(cleanPhone)
  }

  // For US/Canada numbers (11 digits starting with 1)
  if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return `+1 ${cleanPhone.slice(1, 4)} ${cleanPhone.slice(4, 7)} ${cleanPhone.slice(7)}`
  }

  // For 10-digit numbers (likely US without country code)
  if (cleanPhone.length === 10) {
    return `+${cleanPhone.slice(0, 3)} ${cleanPhone.slice(3, 6)} ${cleanPhone.slice(6)}`
  }

  // For international numbers, add + and group in chunks of 3-4
  if (cleanPhone.length > 10) {
    // Assume first 2-3 digits are country code
    const parts: string[] = []
    let remaining = cleanPhone

    // Add country code (2-3 digits for most countries)
    const countryCodeLength = cleanPhone.length <= 12 ? 2 : 3
    parts.push(`+${remaining.slice(0, countryCodeLength)}`)
    remaining = remaining.slice(countryCodeLength)

    // Group remaining digits in chunks of 3-4
    while (remaining.length > 0) {
      const chunkSize = remaining.length > 4 ? 4 : remaining.length
      parts.push(remaining.slice(0, chunkSize))
      remaining = remaining.slice(chunkSize)
    }

    return parts.join(' ')
  }

  return formatPhoneNumber(cleanPhone)
}

/**
 * Extract phone number from a WhatsApp JID
 * Alias for extractPhoneFromJid in jid.ts for convenience
 *
 * @param jid - WhatsApp JID (e.g., "1234567890@s.whatsapp.net")
 * @returns Phone number (digits only) or null if invalid
 */
export function parsePhoneFromJid(jid: string | null | undefined): string | null {
  return extractPhoneFromJid(jid)
}

/**
 * Validate a phone number format
 * Basic validation - checks for reasonable digit count
 *
 * @param phone - Phone number to validate
 * @returns true if phone number appears valid
 */
export function isValidPhoneNumber(phone: string): boolean {
  const cleanPhone = phone.replace(/\D/g, '')

  // Most phone numbers are between 7-15 digits
  return cleanPhone.length >= 7 && cleanPhone.length <= 15
}
