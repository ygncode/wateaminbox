/**
 * Contacts API
 * Contact and contact import related API functions
 */

import {
  fetchWithAuth,
  fetchFormDataWithAuth,
  buildQueryString,
  API_BASE_URL,
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
): Promise<ContactImportPreviewResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return fetchFormDataWithAuth<ContactImportPreviewResponse>(
    "/contacts/import/preview",
    formData,
  );
}

export async function importContacts(
  file: File,
  options: { updateExisting?: boolean; createTags?: boolean } = {},
): Promise<ContactImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options.updateExisting !== undefined) {
    formData.append("updateExisting", String(options.updateExisting));
  }
  if (options.createTags !== undefined) {
    formData.append("createTags", String(options.createTags));
  }
  return fetchFormDataWithAuth<ContactImportResponse>(
    "/contacts/import",
    formData,
  );
}

export function downloadImportTemplate(): void {
  const url = `${API_BASE_URL}/contacts/import/template`;
  window.open(url, "_blank");
}
