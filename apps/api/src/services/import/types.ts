/**
 * Contact import row from CSV/Excel
 *
 * @remarks
 * Represents a single row from an imported CSV/Excel file.
 * The `tags` field should contain comma-separated tag names.
 */
export interface ContactImportRow {
  /** Phone number in any format (will be normalized) */
  phone_number: string
  /** Optional custom display name */
  custom_name?: string
  /** Optional notes/shared notes */
  notes?: string
  /** Comma-separated tag names (e.g., "VIP,Lead,Customer") */
  tags?: string
}

/**
 * Import result for a single contact
 *
 * @remarks
 * Represents the result of importing a single contact row.
 * The status indicates what happened: created, updated, skipped, or error.
 */
export interface ContactImportResult {
  /** Row number in the original import (1-indexed) */
  row: number
  /** Original phone number from the import */
  phoneNumber: string
  /** Import status for this contact */
  status: 'created' | 'updated' | 'skipped' | 'error'
  /** Error message if status is 'error' */
  error?: string
  /** Database ID of the contact (if created/updated) */
  contactId?: string
}

/**
 * Import summary
 *
 * @remarks
 * Aggregated results from a contact import operation.
 * All counts are cumulative; `total` equals `created + updated + skipped + errors`.
 */
export interface ImportSummary {
  /** Total number of rows processed */
  total: number
  /** Number of new contacts created */
  created: number
  /** Number of existing contacts updated */
  updated: number
  /** Number of contacts skipped (not currently used, reserved for future) */
  skipped: number
  /** Number of rows with validation errors (these don't cause rollback) */
  errors: number
  /** Detailed results for each row */
  results: ContactImportResult[]
}
