import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a phone number for display with + prefix and spacing.
 * Input: "44578136657990" or "+44578136657990"
 * Output: "+44 578 136 657990"
 */
export function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return ''

  // Remove any non-digit characters except leading +
  let normalized = phone.replace(/[^\d+]/g, '')

  // Add + prefix if not present
  if (!normalized.startsWith('+')) {
    normalized = `+${normalized}`
  }

  // Simple formatting: add spaces after country code and every 3-4 digits
  if (normalized.length > 4) {
    // Detect country code length (1-3 digits typically)
    // Common patterns: +1 (USA), +44 (UK), +95 (Myanmar), +65 (Singapore)
    let countryCodeLen = 2 // Default: + and 1 digit
    if (normalized.length > 10) {
      // Longer numbers likely have 2-3 digit country codes
      countryCodeLen = 3
    }

    const countryCode = normalized.slice(0, countryCodeLen)
    const rest = normalized.slice(countryCodeLen)

    // Format the rest with spaces every 3-4 digits
    const formatted = rest.replace(/(\d{3,4})(?=\d)/g, '$1 ')
    return `${countryCode} ${formatted}`.trim()
  }

  return normalized
}

/**
 * Extracts phone number from a JID, handling device suffix.
 * Input: "44578136657990:3@s.whatsapp.net" or "44578136657990@s.whatsapp.net"
 * Output: "44578136657990"
 */
export function extractPhoneFromJID(jid: string | null | undefined): string | null {
  if (!jid) return null

  // Remove server suffix (@s.whatsapp.net, @g.us, etc.)
  const userPart = jid.split('@')[0]
  if (!userPart) return null

  // Remove device suffix (the :N part)
  const phoneNumber = userPart.split(':')[0]

  return phoneNumber || null
}
