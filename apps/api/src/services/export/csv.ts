/**
 * CSV Export Utilities
 *
 * Provides functions for converting data to CSV format with proper escaping
 */

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than
 * text. Exported rows carry attacker-controlled content (WhatsApp message
 * bodies, push names, contact names), so a cell starting with one of these
 * would execute in Excel/LibreOffice/Sheets when an operator opens the file.
 */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@"]);

/**
 * Leading control characters that spreadsheets skip before deciding whether a
 * cell is a formula, so they must be neutralized too.
 */
const LEADING_CONTROL_CHARS = new Set(["\t", "\r"]);

/**
 * Neutralize spreadsheet formula injection ("CSV injection").
 *
 * A leading apostrophe forces the cell to be read as literal text. The value
 * itself is preserved, so re-importing the file still round-trips the visible
 * content.
 */
function neutralizeFormula(value: string): string {
  const first = value[0];
  if (first === undefined) return value;
  if (FORMULA_TRIGGERS.has(first) || LEADING_CONTROL_CHARS.has(first)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Quote and escape a value for a CSV cell after neutralizing formulas.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const str = neutralizeFormula(String(value));

  // Escape quotes and wrap in quotes if the value contains a delimiter,
  // a line break, or a quote of its own.
  if (
    str.includes(",") ||
    str.includes("\n") ||
    str.includes("\r") ||
    str.includes('"')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Convert array of objects to CSV string
 *
 * Handles:
 * - Comma escaping
 * - Quote escaping
 * - Newline handling
 * - Null/undefined values
 * - Spreadsheet formula injection in untrusted cell values
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
  const header = keys.map(formatCell).join(",");

  const rows = data.map((row) =>
    keys.map((key) => formatCell(row[key])).join(","),
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
  return formatCell(value);
}

/**
 * Create CSV header row from column names
 *
 * @param columns - Array of column names
 * @returns CSV header string
 */
export function createCSVHeader(columns: string[]): string {
  return columns.map(formatCell).join(",");
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
  return columns.map((key) => formatCell(row[key])).join(",");
}
