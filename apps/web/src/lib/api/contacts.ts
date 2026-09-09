/**
 * Contacts API
 * Contact and contact import related API functions
 */

import {
  buildQueryString,
  fetchBlobWithAuth,
  fetchFormDataWithAuth,
  fetchWithAuth,
} from "./client.js";
import type {
  ApiResponse,
  Contact,
  ContactImportPreviewResponse,
  ContactImportResponse,
  PaginationParams,
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

export interface MergeSuggestion {
  contactId: string;
  /** The normalized phone or email both customers were seen at. */
  matchedAddress: string;
  channels: string[];
  sameChannel: boolean;
  /**
   * The candidate's matching endpoint is provider- or user-verified.
   * Unverified evidence is a suggestion only and still needs a human decision.
   */
  verified: boolean;
}

export interface MergeResult {
  mergeEventId: string;
  movedEndpoints: number;
  sourceContactId: string;
  targetContactId: string;
}

/**
 * Candidates that share a normalized address with this customer.
 *
 * Read-only evidence. The endpoint is admin/owner only and is deliberately not
 * behind the merge execution gate, so candidates can be reviewed long before a
 * workspace is allowed to act on them.
 */
export async function getMergeSuggestions(
  contactId: string,
): Promise<MergeSuggestion[]> {
  const response = await fetchWithAuth<ApiResponse<MergeSuggestion[]>>(
    `/contacts/${encodeURIComponent(contactId)}/merge-suggestions`,
  );
  return response.data ?? [];
}

/** Merge `sourceContactId` into `contactId`, which survives. */
export async function mergeContact(
  contactId: string,
  sourceContactId: string,
  reason: string,
): Promise<MergeResult> {
  const response = await fetchWithAuth<ApiResponse<MergeResult>>(
    `/contacts/${encodeURIComponent(contactId)}/merge`,
    {
      method: "POST",
      body: JSON.stringify({ sourceContactId, reason }),
    },
  );
  return response.data as MergeResult;
}
