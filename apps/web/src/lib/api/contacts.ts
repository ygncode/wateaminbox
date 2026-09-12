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

/** One merge that produced this customer. */
export interface MergeHistoryEntry {
  mergeEventId: string;
  sourceContactId: string;
  sourceName: string | null;
  actorUserId: string;
  reason: string;
  mergedAt: string;
  reversible: boolean;
}

/** What was merged into this customer, newest first. */
export async function getMergeHistory(
  contactId: string,
): Promise<MergeHistoryEntry[]> {
  // `fetchWithAuth` already unwraps the `{ data }` envelope, so this is the
  // payload itself. Reading `.data` off it silently produced an empty list,
  // which the section is indistinguishable from "nothing was merged".
  const response = await fetchWithAuth<{ merges: MergeHistoryEntry[] }>(
    `/contacts/${encodeURIComponent(contactId)}/merge-history`,
  );
  return response?.merges ?? [];
}

/** Reverse one merge, restoring the endpoints it moved. */
export async function unmergeContact(
  mergeEventId: string,
  reason: string,
): Promise<{ restoredEndpoints: number; skippedEndpoints: number }> {
  return await fetchWithAuth<{
    restoredEndpoints: number;
    skippedEndpoints: number;
  }>(`/contacts/merges/${encodeURIComponent(mergeEventId)}/unmerge`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** One thread a customer can be reached on. */
export interface CustomerChat {
  /** The id the chat route addresses - a contact id, or a conversation id. */
  chatId: string;
  conversationId: string | null;
  contactId: string | null;
  channel: string;
  provider: string;
  accountId: string | null;
  accountName: string | null;
  address: string | null;
  /** The WhatsApp JID this thread sends on, when it has one. */
  jid: string | null;
  displayName: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

/**
 * Every thread this customer is reachable on, newest activity first.
 *
 * More than one only after a merge: a merge combines identity and leaves the
 * conversations alone, so a merged customer keeps a separate thread per
 * endpoint and the composer switches between them.
 */
export async function getCustomerChats(
  contactId: string,
): Promise<CustomerChat[]> {
  const response = await fetchWithAuth<{ chats: CustomerChat[] }>(
    `/contacts/${encodeURIComponent(contactId)}/chats`,
  );
  return response?.chats ?? [];
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
  const response = await fetchWithAuth<MergeSuggestion[]>(
    `/contacts/${encodeURIComponent(contactId)}/merge-suggestions`,
  );
  return response ?? [];
}

/** Merge `sourceContactId` into `contactId`, which survives. */
export async function mergeContact(
  contactId: string,
  sourceContactId: string,
  reason: string,
): Promise<MergeResult> {
  return await fetchWithAuth<MergeResult>(
    `/contacts/${encodeURIComponent(contactId)}/merge`,
    {
      method: "POST",
      body: JSON.stringify({ sourceContactId, reason }),
    },
  );
}
