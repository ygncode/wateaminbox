/**
 * Phone number utilities
 */

/**
 * Format a phone number for display
 * Adds "+" prefix for international numbers (>10 digits)
 *
 * @param phone - Phone number (digits only, without country code prefix)
 * @returns Formatted phone number for display
 *
 * @example
 * ```ts
 * formatPhoneNumber("1234567890")     // "1234567890"
 * formatPhoneNumber("11234567890")    // "+11234567890"
 * formatPhoneNumber("44123456789")    // "+44123456789"
 * ```
 */
export function formatPhoneNumber(phone: string): string {
  // Ensure we have a clean number (digits only)
  const cleanPhone = phone.replace(/\D/g, '')

  // Add + prefix for international numbers (more than 10 digits suggests country code)
  if (cleanPhone.length > 10) {
    return `+${cleanPhone}`
  }

  return cleanPhone
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

  // For very short numbers, don't format
  if (cleanPhone.length < 7) {
    return cleanPhone
  }

  // For US/Canada numbers (11 digits starting with 1)
  if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return `+1 ${cleanPhone.slice(1, 4)} ${cleanPhone.slice(4, 7)} ${cleanPhone.slice(7)}`
  }

  // For 10-digit numbers (likely US without country code)
  if (cleanPhone.length === 10) {
    return `${cleanPhone.slice(0, 3)} ${cleanPhone.slice(3, 6)} ${cleanPhone.slice(6)}`
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

  return cleanPhone
}

/**
 * Extract phone number from a WhatsApp JID
 * Alias for extractPhoneFromJid in jid.ts for convenience
 *
 * @param jid - WhatsApp JID (e.g., "1234567890@s.whatsapp.net")
 * @returns Phone number (digits only) or null if invalid
 */
export function parsePhoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null

  // Remove server suffix (@s.whatsapp.net, @g.us, etc.)
  const userPart = jid.split('@')[0]
  if (!userPart) return null

  // Remove device suffix (the :N part, e.g., ":3")
  const phone = userPart.split(':')[0]

  // Clean the phone number: remove all non-digit characters
  const cleanedPhone = phone.replace(/\D/g, '')

  return cleanedPhone || null
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
