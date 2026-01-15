import { useMutation } from "@tanstack/react-query";
import { dayjs } from "@whatsapp-web/shared";
import {
  API_BASE_URL,
  buildQueryString,
  getAccessToken,
  getCompanyId,
} from "@/lib/api/client";

/**
 * Export format types
 */
export type ExportFormat = "csv" | "json";

/**
 * Contact export filters
 */
export interface ContactExportFilters {
  tagIds?: string[];
  assignedTo?: string;
  hasCustomName?: boolean;
}

/**
 * Message export filters
 */
export interface MessageExportFilters {
  contactId?: string;
  startDate?: string;
  endDate?: string;
  messageTypes?: string[];
  limit?: number;
}

/**
 * Full backup export filters
 */
export interface FullBackupFilters {
  startDate?: string;
  endDate?: string;
}

/**
 * Get headers with auth and company ID for export requests.
 * Export requests need raw Response for blob handling, so we build headers manually.
 * @throws {Error} If token or company ID is missing
 */
function getExportHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const token = getAccessToken();
  if (!token) {
    throw new Error("Authentication required. Please log in again.");
  }
  headers.Authorization = `Bearer ${token}`;

  const companyId = getCompanyId();
  if (!companyId) {
    throw new Error(
      "No company selected. Please select a company to continue.",
    );
  }
  headers["X-Company-ID"] = companyId;

  return headers;
}

/**
 * Download a file from blob
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Fetch with export handling (needs raw Response for blob)
 */
async function fetchExport(
  endpoint: string,
  options?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...getExportHeaders(),
      ...options?.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Export failed");
  }

  return response;
}

/**
 * Hook to export contacts
 */
export function useExportContacts() {
  return useMutation({
    mutationFn: async ({
      format = "csv",
      filters = {},
    }: {
      format?: ExportFormat;
      filters?: ContactExportFilters;
    }) => {
      const params: Record<string, unknown> = { format };
      if (filters.tagIds?.length) params.tagIds = filters.tagIds.join(",");
      if (filters.assignedTo) params.assignedTo = filters.assignedTo;
      if (filters.hasCustomName) params.hasCustomName = "true";

      const queryString = buildQueryString(params);
      const response = await fetchExport(`/export/contacts${queryString}`);

      if (format === "json") {
        return response.json();
      }

      const blob = await response.blob();
      const filename = `contacts-${dayjs().format("YYYY-MM-DD")}.csv`;
      downloadBlob(blob, filename);
      return { success: true };
    },
  });
}

/**
 * Hook to export messages
 */
export function useExportMessages() {
  return useMutation({
    mutationFn: async ({
      format = "csv",
      filters = {},
    }: {
      format?: ExportFormat;
      filters?: MessageExportFilters;
    }) => {
      const params: Record<string, unknown> = { format };
      if (filters.contactId) params.contactId = filters.contactId;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.messageTypes?.length)
        params.messageTypes = filters.messageTypes.join(",");
      if (filters.limit) params.limit = filters.limit;

      const queryString = buildQueryString(params);
      const response = await fetchExport(`/export/messages${queryString}`);

      if (format === "json") {
        return response.json();
      }

      const blob = await response.blob();
      const filename = `messages-${dayjs().format("YYYY-MM-DD")}.csv`;
      downloadBlob(blob, filename);
      return { success: true };
    },
  });
}

/**
 * Hook to export conversation
 */
export function useExportConversation() {
  return useMutation({
    mutationFn: async ({
      contactId,
      format = "json",
      startDate,
      endDate,
    }: {
      contactId: string;
      format?: ExportFormat;
      startDate?: string;
      endDate?: string;
    }) => {
      const params: Record<string, unknown> = { format };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const queryString = buildQueryString(params);
      const response = await fetchExport(
        `/export/conversation/${contactId}${queryString}`,
      );

      if (format === "json") {
        return response.json();
      }

      const blob = await response.blob();
      const filename = `conversation-${contactId}-${dayjs().format("YYYY-MM-DD")}.csv`;
      downloadBlob(blob, filename);
      return { success: true };
    },
  });
}

/**
 * Hook for bulk export
 */
export function useBulkExport() {
  return useMutation({
    mutationFn: async ({
      type,
      format = "csv",
      filters = {},
    }: {
      type: "contacts" | "messages";
      format?: ExportFormat;
      filters?: ContactExportFilters & MessageExportFilters;
    }) => {
      const response = await fetchExport("/export/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type, format, filters }),
      });

      if (format === "json") {
        return response.json();
      }

      const blob = await response.blob();
      const filename = `${type}-${dayjs().format("YYYY-MM-DD")}.csv`;
      downloadBlob(blob, filename);
      return { success: true };
    },
  });
}

/**
 * Hook for full backup export as ZIP
 */
export function useFullBackupExport() {
  return useMutation({
    mutationFn: async (filters: FullBackupFilters = {}) => {
      const params: Record<string, unknown> = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;

      const queryString = buildQueryString(params);
      const response = await fetchExport(`/export/full${queryString}`);

      const blob = await response.blob();
      const filename = `whatsapp-backup-${dayjs().format("YYYY-MM-DD")}.zip`;
      downloadBlob(blob, filename);
      return { success: true };
    },
  });
}
