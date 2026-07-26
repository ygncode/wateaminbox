import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import relativeTime from 'dayjs/plugin/relativeTime'

// Initialize plugins
dayjs.extend(utc)
dayjs.extend(relativeTime)

// Re-export dayjs for direct usage when needed
export { dayjs }

// Type for accepted date inputs
export type DateInput = Date | string | number | dayjs.Dayjs | null | undefined

// ============================================
// CORE UTILITIES
// ============================================

/**
 * Parse any date input to a dayjs instance in UTC
 * Returns null if input is invalid
 */
export function parseDate(input: DateInput): dayjs.Dayjs | null {
  if (input === null || input === undefined) return null
  const parsed = dayjs.utc(input)
  return parsed.isValid() ? parsed : null
}

/**
 * Get current time in UTC
 */
export function now(): dayjs.Dayjs {
  return dayjs.utc()
}

/**
 * Get current timestamp in milliseconds
 * Replacement for Date.now()
 */
export function nowMs(): number {
  return Date.now()
}

/**
 * Convert to ISO string in UTC
 */
export function toISOString(input?: DateInput): string {
  if (input === null || input === undefined) {
    return dayjs.utc().toISOString()
  }
  const parsed = parseDate(input)
  return parsed ? parsed.toISOString() : dayjs.utc().toISOString()
}

/**
 * Convert to Date object
 * Returns null if input is invalid
 */
export function toDate(input: DateInput): Date | null {
  const parsed = parseDate(input)
  return parsed ? parsed.toDate() : null
}

/**
 * Get Date object for database storage (UTC)
 * Returns current date if no input provided
 */
export function toDbDate(input?: DateInput): Date {
  if (input === null || input === undefined) {
    return dayjs.utc().toDate()
  }
  const parsed = parseDate(input)
  return parsed ? parsed.toDate() : dayjs.utc().toDate()
}

// ============================================
// RELATIVE TIME FORMATTING
// ============================================

/**
 * Format relative time (e.g., "5 minutes ago", "2 hours ago")
 * Uses dayjs relativeTime plugin
 */
export function formatRelativeTime(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''
  return parsed.fromNow()
}

/**
 * Format relative time in short form for compact displays
 * e.g., "5m ago", "2h ago", "3d ago"
 */
export function formatStatusTime(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''

  const nowTime = dayjs.utc()
  const diffMs = nowTime.diff(parsed)
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

/**
 * Format for "last seen" display with WhatsApp-style logic
 * - "online" if currently online
 * - empty if presence/last seen is unavailable (for example due to privacy settings)
 * - "last seen just now" if < 1 minute
 * - "last seen X minutes ago" if < 1 hour
 * - "last seen X hours ago" if < 24 hours
 * - "last seen yesterday at HH:mm"
 * - "last seen Monday at HH:mm" (within 7 days)
 * - "last seen Mon, Jan 15, 2024" (older)
 */
export function formatLastSeen(input: DateInput, isOnline?: boolean): string {
  if (isOnline) return 'online'

  const parsed = parseDate(input)
  if (!parsed) return ''

  const nowTime = dayjs.utc()
  const local = parsed.local()
  const diffMs = nowTime.diff(parsed)
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return 'last seen just now'
  if (diffMinutes < 60) {
    return `last seen ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }
  if (diffHours < 24) {
    return `last seen ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }
  if (diffDays === 1) {
    return `last seen yesterday at ${local.format('HH:mm')}`
  }
  if (diffDays < 7) {
    return `last seen ${local.format('dddd')} at ${local.format('HH:mm')}`
  }

  return `last seen ${local.format('MMM D, YYYY')}`
}

// ============================================
// MESSAGE & CHAT TIME FORMATTING
// ============================================

/**
 * Format time for message bubbles (HH:mm in local time)
 */
export function formatMessageTime(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''
  return parsed.local().format('HH:mm')
}

/**
 * Format timestamp for chat list with smart display:
 * - Today: HH:mm (e.g., "14:30")
 * - Yesterday: "Yesterday"
 * - This week: Day name (e.g., "Mon", "Tue")
 * - Older this year: Short date (e.g., "Jan 5")
 * - Previous years: Date with year (e.g., "Jan 5, 2025")
 */
export function formatChatListTime(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''

  const local = parsed.local()
  const nowLocal = dayjs().local()
  const diffDays = nowLocal.startOf('day').diff(local.startOf('day'), 'day')

  if (diffDays === 0) {
    // Today - show time
    return local.format('HH:mm')
  }
  if (diffDays === 1) {
    return 'Yesterday'
  }
  if (diffDays < 7) {
    // This week - show day name
    return local.format('ddd')
  }
  // Include the year for older conversations so a list spanning multiple
  // years does not look chronologically incorrect (e.g. Mar above Aug).
  if (local.year() !== nowLocal.year()) {
    return local.format('MMM D, YYYY')
  }
  return local.format('MMM D')
}

/**
 * Format for audit log timestamps (full date + time in local timezone)
 */
export function formatAuditTime(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''
  return parsed.local().format('MMM D, YYYY HH:mm:ss')
}

/**
 * Format date separator for message thread
 * - Today: "Today"
 * - Yesterday: "Yesterday"
 * - This week: Full day name (e.g., "Monday")
 * - Older: Full date (e.g., "Monday, January 15")
 */
export function formatDateSeparator(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''

  const local = parsed.local()
  const nowLocal = dayjs().local()
  const diffDays = nowLocal.startOf('day').diff(local.startOf('day'), 'day')

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return local.format('dddd')

  // Older - show full date
  return local.format('dddd, MMMM D')
}

// ============================================
// DATE RANGE & ANALYTICS HELPERS
// ============================================

/**
 * Get date range for analytics
 * Returns start and end dates in UTC
 */
export function getDateRange(range: '7d' | '30d' | '90d'): { start: dayjs.Dayjs; end: dayjs.Dayjs } {
  const end = dayjs.utc()
  let start: dayjs.Dayjs

  switch (range) {
    case '7d':
      start = end.subtract(7, 'day')
      break
    case '30d':
      start = end.subtract(30, 'day')
      break
    case '90d':
      start = end.subtract(90, 'day')
      break
  }

  return { start, end }
}

/**
 * Get start of day in UTC
 */
export function startOfDay(input?: DateInput): dayjs.Dayjs {
  if (input === null || input === undefined) {
    return dayjs.utc().startOf('day')
  }
  const parsed = parseDate(input)
  return parsed ? parsed.startOf('day') : dayjs.utc().startOf('day')
}

/**
 * Get end of day in UTC (23:59:59.999)
 */
export function endOfDay(input?: DateInput): dayjs.Dayjs {
  if (input === null || input === undefined) {
    return dayjs.utc().endOf('day')
  }
  const parsed = parseDate(input)
  return parsed ? parsed.endOf('day') : dayjs.utc().endOf('day')
}

/**
 * Subtract days from date
 */
export function subtractDays(input: DateInput, days: number): dayjs.Dayjs {
  const parsed = parseDate(input)
  if (!parsed) return dayjs.utc().subtract(days, 'day')
  return parsed.subtract(days, 'day')
}

/**
 * Add days to date
 */
export function addDays(input: DateInput, days: number): dayjs.Dayjs {
  const parsed = parseDate(input)
  if (!parsed) return dayjs.utc().add(days, 'day')
  return parsed.add(days, 'day')
}

/**
 * Check if date is today (in local time)
 */
export function isToday(input: DateInput): boolean {
  const parsed = parseDate(input)
  if (!parsed) return false
  return parsed.local().isSame(dayjs().local(), 'day')
}

/**
 * Check if date is yesterday (in local time)
 */
export function isYesterday(input: DateInput): boolean {
  const parsed = parseDate(input)
  if (!parsed) return false
  const yesterday = dayjs().local().subtract(1, 'day')
  return parsed.local().isSame(yesterday, 'day')
}

// ============================================
// EXPORT-SPECIFIC FORMATTING
// ============================================

/**
 * Format date for export filenames (YYYY-MM-DD)
 */
export function formatForFilename(input?: DateInput): string {
  if (input === null || input === undefined) {
    return dayjs.utc().format('YYYY-MM-DD')
  }
  const parsed = parseDate(input)
  return parsed ? parsed.format('YYYY-MM-DD') : dayjs.utc().format('YYYY-MM-DD')
}

/**
 * Format date for analytics with short month (e.g., "Jan 15")
 */
export function formatShortDate(input: DateInput): string {
  const parsed = parseDate(input)
  if (!parsed) return ''
  return parsed.local().format('MMM D')
}

// ============================================
// DATABASE HELPERS
// ============================================

/**
 * Get Unix timestamp in seconds (for JWT)
 */
export function getUnixTimestamp(input?: DateInput): number {
  if (input === null || input === undefined) {
    return Math.floor(Date.now() / 1000)
  }
  const parsed = parseDate(input)
  return parsed ? parsed.unix() : Math.floor(Date.now() / 1000)
}
