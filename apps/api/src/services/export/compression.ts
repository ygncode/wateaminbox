/**
 * Compression and Backup Utilities
 *
 * Handles ZIP file creation and README generation for data exports
 */

import * as fflate from "fflate";
import { dayjs } from "@wateaminbox/shared";
import type { ContactExport, MessageExport } from "../export.service.js";
import { toCSV } from "./csv.js";

/**
 * Full backup export data structure
 */
export interface FullBackupData {
  exportedAt: string;
  contacts: ContactExport[];
  messages: MessageExport[];
  stats: {
    totalContacts: number;
    totalMessages: number;
    dateRange: {
      start: string | null;
      end: string | null;
    };
  };
}

/**
 * Options for backup ZIP generation
 */
export interface BackupZipOptions {
  startDate?: Date;
  endDate?: Date;
  includeMedia?: boolean;
}

/**
 * Generate a ZIP file containing backup data
 *
 * Creates a ZIP with:
 * - README.txt
 * - contacts.json
 * - contacts.csv
 * - messages.json
 * - messages.csv
 * - backup-summary.json
 *
 * Uses async compression to avoid blocking the event loop for large files
 *
 * @param backupData - The backup data to include in the ZIP
 * @param options - Options that were used for the backup (for README)
 * @returns Promise resolving to ZIP file as Uint8Array
 */
export async function generateBackupZip(
  backupData: FullBackupData,
  options: BackupZipOptions = {},
): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  // Generate README content
  const readme = generateBackupReadme(backupData.stats, options);

  // Prepare all files to include in ZIP
  const files: Record<string, Uint8Array> = {
    "README.txt": encoder.encode(readme),
    "contacts.json": encoder.encode(
      JSON.stringify(backupData.contacts, null, 2),
    ),
    "contacts.csv": encoder.encode(
      toCSV(backupData.contacts as unknown as Record<string, unknown>[]),
    ),
    "messages.json": encoder.encode(
      JSON.stringify(backupData.messages, null, 2),
    ),
    "messages.csv": encoder.encode(
      toCSV(backupData.messages as unknown as Record<string, unknown>[]),
    ),
    "backup-summary.json": encoder.encode(JSON.stringify(backupData, null, 2)),
  };

  // Use async ZIP to avoid blocking the event loop for large files
  const zipData = await new Promise<Uint8Array>((resolve, reject) => {
    fflate.zip(files, { level: 6 }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });

  return zipData;
}

/**
 * Generate README content for backup ZIP
 *
 * Creates a formatted text file explaining the backup contents
 *
 * @param stats - Statistics about the backup
 * @param options - Options that were used for the backup
 * @returns README content as string
 */
export function generateBackupReadme(
  stats: FullBackupData["stats"],
  options: BackupZipOptions,
): string {
  const now = dayjs.utc();
  const dateStr = now.format("YYYY-MM-DD");
  const timeStr = now.format("HH:mm:ss");

  let content = `WhatsApp Web Backup
===================

Export Date: ${dateStr} ${timeStr} UTC

Backup Contents
---------------
- contacts.json    : All contacts in JSON format
- contacts.csv     : All contacts in CSV format
- messages.json    : All messages in JSON format
- messages.csv     : All messages in CSV format
- backup-summary.json : Complete backup with metadata

Statistics
----------
- Total Contacts: ${stats.totalContacts}
- Total Messages: ${stats.totalMessages}
`;

  if (stats.dateRange.start && stats.dateRange.end) {
    content += `- Message Date Range: ${stats.dateRange.start.split("T")[0]} to ${stats.dateRange.end.split("T")[0]}
`;
  }

  if (options.startDate || options.endDate) {
    content += `
Filters Applied
---------------
`;
    if (options.startDate) {
      content += `- Start Date: ${dayjs(options.startDate).format("YYYY-MM-DD")}
`;
    }
    if (options.endDate) {
      content += `- End Date: ${dayjs(options.endDate).format("YYYY-MM-DD")}
`;
    }
  }

  content += `
File Formats
------------
JSON files can be opened with any text editor or JSON viewer.
CSV files can be opened with Excel, Google Sheets, or any spreadsheet software.

For more information, visit your WhatsApp Web dashboard.
`;

  return content;
}

/**
 * Compress a single file to gzip format
 *
 * @param data - Data to compress
 * @returns Promise resolving to compressed data
 */
export async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    fflate.gzip(data, { level: 6 }, (err, compressed) => {
      if (err) {
        reject(err);
      } else {
        resolve(compressed);
      }
    });
  });
}
