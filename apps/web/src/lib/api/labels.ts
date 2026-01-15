/**
 * Labels API
 * WhatsApp label management and sync API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  WhatsAppLabel,
  LabelSyncStatus,
  TagWithLabelStatus,
  SyncLabelsResponse,
  LinkTagResponse,
  AutoCreateTagsResponse,
} from "./types.js";

export async function getWhatsAppLabels(): Promise<WhatsAppLabel[]> {
  // Labels endpoint returns paginated response { data, pagination }
  const response = await fetchWithAuth<{
    data: WhatsAppLabel[];
    pagination: unknown;
  }>("/labels");
  return response.data;
}

export async function getLabelSyncStatus(): Promise<LabelSyncStatus> {
  return fetchWithAuth<LabelSyncStatus>("/labels/status");
}

export async function getWhatsAppLabel(
  labelId: string,
): Promise<WhatsAppLabel> {
  return fetchWithAuth<WhatsAppLabel>(`/labels/${labelId}`);
}

export async function triggerLabelSync(): Promise<SyncLabelsResponse> {
  return fetchWithAuth<SyncLabelsResponse>("/labels/sync", {
    method: "POST",
  });
}

export async function linkTagToLabel(
  labelId: string,
  tagId: string,
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(`/labels/${labelId}/link`, {
    method: "POST",
    body: JSON.stringify({ tagId }),
  });
}

export async function unlinkTagFromLabel(
  labelId: string,
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(`/labels/${labelId}/link`, {
    method: "DELETE",
  });
}

export async function autoCreateTagsFromLabels(): Promise<AutoCreateTagsResponse> {
  return fetchWithAuth<AutoCreateTagsResponse>("/labels/auto-create", {
    method: "POST",
  });
}

export async function getTagsWithLabelStatus(): Promise<TagWithLabelStatus[]> {
  return fetchWithAuth<TagWithLabelStatus[]>("/labels/tags/with-status");
}

export async function applyLabelToContact(
  labelId: string,
  contactId: string,
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(
    `/labels/${labelId}/apply/${contactId}`,
    {
      method: "POST",
    },
  );
}

export async function removeLabelFromContact(
  labelId: string,
  contactId: string,
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(
    `/labels/${labelId}/apply/${contactId}`,
    {
      method: "DELETE",
    },
  );
}
