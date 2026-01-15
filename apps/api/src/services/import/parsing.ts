/**
 * Parse a single CSV line handling quoted values
 *
 * @remarks
 * Supports:
 * - Quoted values containing commas: `"Doe, John",+1234567890`
 * - Escaped quotes within quoted values: `"John ""The Boss"" Doe"`
 *
 * @param line - A single line from a CSV file
 * @returns Array of parsed string values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse CSV content to array of objects
 *
 * @remarks
 * Parses CSV content with support for quoted values and escaped quotes.
 * Column names are normalized to lowercase with underscores (e.g., "Phone Number" → "phone_number").
 *
 * @param content - Raw CSV content as a string
 * @returns Array of objects where keys are normalized column names
 *
 * @example
 * ```ts
 * const csv = 'phone_number,name\n+1234567890,John Doe'
 * const rows = parseCSV(csv)
 * // => [{ phone_number: '+1234567890', name: 'John Doe' }]
 * ```
 */
export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  // Parse header
  const header = parseCSVLine(lines[0]);

  // Parse rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === ""))
      continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j].toLowerCase().trim().replace(/\s+/g, "_");
      row[key] = values[j] || "";
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Generate a sample CSV template for contact import
 *
 * @remarks
 * Creates a downloadable CSV template that users can fill in with their contact data.
 * The template includes example rows showing the expected format.
 *
 * @returns CSV-formatted string with header and sample rows
 *
 * @example
 * ```ts
 * const csv = generateImportTemplate()
 * // => "phone_number,name,notes,tags\n+1234567890,John Doe,Important customer,VIP,Lead\n..."
 * ```
 */
export function generateImportTemplate(): string {
  const header = "phone_number,name,notes,tags";
  const sampleRows = [
    "+1234567890,John Doe,Important customer,VIP,Lead",
    "+0987654321,Jane Smith,Follow up next week,Lead",
    "1122334455,Bob Wilson,,Customer",
  ];

  return [header, ...sampleRows].join("\n");
}
