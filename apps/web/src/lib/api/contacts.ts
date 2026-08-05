/**
 * Contacts API
 * Contact and contact import related API functions
 */

import {
  fetchWithAuth,
  fetchFormDataWithAuth,
  fetchBlobWithAuth,
  buildQueryString,
} from "./client.js";
import type {
  Contact,
  ApiResponse,
  PaginationParams,
  ContactImportPreviewResponse,
  ContactImportResponse,
} from "./types.js";

export async function getContacts(
  params?: PaginationParams,
): Promise<ApiResponse<Contact[]>> {
  const query = params
    ? buildQueryString(params as Record<string, unknown>)
    : "";
  return fetchWithAuth<ApiResponse<Contact[]>>(`/contacts${query}`);
}

export async function getContact(contactId: string): Promise<Contact> {
  return fetchWithAuth<Contact>(`/contacts/${contactId}`);
}

export async function updateContact(
  contactId: string,
  data: Partial<Pick<Contact, "customName" | "isBlocked">>,
): Promise<Contact> {
  return fetchWithAuth<Contact>(`/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function previewContactImport(
  file: File,
  connectionId?: string,
): Promise<ContactImportPreviewResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (connectionId) {
    formData.append("connectionId", connectionId);
  }
  return fetchFormDataWithAuth<ContactImportPreviewResponse>(
    "/contacts/import/preview",
    formData,
  );
}

export async function importContacts(
  file: File,
  options: {
    updateExisting?: boolean;
    createTags?: boolean;
    connectionId?: string;
  } = {},
): Promise<ContactImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options.updateExisting !== undefined) {
    formData.append("updateExisting", String(options.updateExisting));
  }
  if (options.createTags !== undefined) {
    formData.append("createTags", String(options.createTags));
  }
  if (options.connectionId) {
    formData.append("connectionId", options.connectionId);
  }
  return fetchFormDataWithAuth<ContactImportResponse>(
    "/contacts/import",
    formData,
  );
}

/**
 * Download the CSV import template.
 *
 * The endpoint sits behind the bearer-token auth middleware, so the file has to
 * be fetched with the Authorization header and handed to the browser as a blob.
 * A plain navigation (window.open) carries no header and only renders the
 * middleware's Unauthorized JSON.
 */
export async function downloadImportTemplate(): Promise<void> {
  const blob = await fetchBlobWithAuth("/contacts/import/template");
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = "contact-import-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
