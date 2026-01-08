/**
 * User-related utility functions
 */

/**
 * Extract display name from email address.
 * Returns the portion before the "@" symbol, or the full string if no "@" is found.
 *
 * @param email - Email address to extract display name from
 * @returns The portion before "@" or the full email if malformed
 *
 * @example
 * getEmailDisplayName("john.doe@example.com") // "john.doe"
 * getEmailDisplayName("user@domain.com") // "user"
 * getEmailDisplayName("malformed") // "malformed"
 * getEmailDisplayName("") // ""
 */
export function getEmailDisplayName(email: string): string {
  if (!email) return ''
  const atIndex = email.indexOf('@')
  return atIndex > 0 ? email.substring(0, atIndex) : email
}

/**
 * Get user display name with fallback chain.
 * Tries name first, then email prefix, then returns the fallback.
 *
 * @param name - User's name (may be null/undefined)
 * @param email - User's email (may be null/undefined)
 * @param fallback - Fallback value if neither name nor email is available
 * @returns The best available display name
 *
 * @example
 * getUserDisplayName("John Doe", "john@example.com", "unknown") // "John Doe"
 * getUserDisplayName(null, "john@example.com", "unknown") // "john"
 * getUserDisplayName(null, null, "user123") // "user123"
 */
export function getUserDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
  fallback: string
): string {
  if (name) return name
  if (email) return getEmailDisplayName(email)
  return fallback
}
