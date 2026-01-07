import { useMutation } from "@tanstack/react-query";
import { dayjs } from "@whatsapp-web/shared";
import { getAccessToken, getCompanyId } from "@/lib/api";

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

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";

/**
 * Get headers with auth and company ID
 * @throws {Error} If token or company ID is missing
 */
function getHeaders(): Record<string, string> {
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
      const params = new URLSearchParams();
      params.set("format", format);
      if (filters.tagIds?.length)
        params.set("tagIds", filters.tagIds.join(","));
      if (filters.assignedTo) params.set("assignedTo", filters.assignedTo);
      if (filters.hasCustomName) params.set("hasCustomName", "true");

      const response = await fetch(
        `${API_BASE_URL}/export/contacts?${params}`,
        {
          headers: getHeaders(),
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

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
      const params = new URLSearchParams();
      params.set("format", format);
      if (filters.contactId) params.set("contactId", filters.contactId);
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);
      if (filters.messageTypes?.length)
        params.set("messageTypes", filters.messageTypes.join(","));
      if (filters.limit) params.set("limit", String(filters.limit));

      const response = await fetch(
        `${API_BASE_URL}/export/messages?${params}`,
        {
          headers: getHeaders(),
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

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
      const params = new URLSearchParams();
      params.set("format", format);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const response = await fetch(
        `${API_BASE_URL}/export/conversation/${contactId}?${params}`,
        {
          headers: getHeaders(),
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

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
      const response = await fetch(`${API_BASE_URL}/export/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({ type, format, filters }),
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

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
 * Full backup export filters
 */
export interface FullBackupFilters {
  startDate?: string;
  endDate?: string;
}

/**
 * Hook for full backup export as ZIP
 */
export function useFullBackupExport() {
  return useMutation({
    mutationFn: async (filters: FullBackupFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);

      const response = await fetch(`${API_BASE_URL}/export/full?${params}`, {
        headers: getHeaders(),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Full backup export failed");
      }

      const blob = await response.blob();
      const filename = `whatsapp-backup-${dayjs().format("YYYY-MM-DD")}.zip`;
      downloadBlob(blob, filename);
      return { success: true };
    },
  });
}
