/**
 * CSV Export Utilities
 *
 * Provides functions for converting data to CSV format with proper escaping
 */

/**
 * Convert array of objects to CSV string
 *
 * Handles:
 * - Comma escaping
 * - Quote escaping
 * - Newline handling
 * - Null/undefined values
 *
 * @param data - Array of objects to convert
 * @param columns - Optional array of column names to include (defaults to all keys)
 * @returns CSV string with header and data rows
 */
export function toCSV(
  data: Record<string, unknown>[],
  columns?: string[],
): string {
  if (data.length === 0) return "";

  const keys = columns || Object.keys(data[0]);
  const header = keys.join(",");

  const rows = data.map((row) =>
    keys
      .map((key) => {
        const value = row[key];
        if (value === null || value === undefined) return "";
        const str = String(value);
        // Escape quotes and wrap in quotes if contains comma or newline
        if (str.includes(",") || str.includes("\n") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(","),
  );

  return [header, ...rows].join("\n");
}

/**
 * Escape a single CSV cell value
 *
 * @param value - Value to escape
 * @returns Escaped string suitable for CSV cell
 */
export function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const str = String(value);

  // If contains special characters, wrap in quotes and escape internal quotes
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Create CSV header row from column names
 *
 * @param columns - Array of column names
 * @returns CSV header string
 */
export function createCSVHeader(columns: string[]): string {
  return columns.join(",");
}

/**
 * Create CSV data row from object and column order
 *
 * @param row - Data object
 * @param columns - Array of column names in order
 * @returns CSV row string
 */
export function createCSVRow(
  row: Record<string, unknown>,
  columns: string[],
): string {
  return columns.map((key) => escapeCSVCell(row[key])).join(",");
}
