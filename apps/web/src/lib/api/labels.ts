/**
 * Labels API
 * WhatsApp label management and sync API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  WhatsAppLabel,
  LabelSyncStatus,
  TagWithLabelStatus,
  LabelListResponse,
  TagsWithStatusResponse,
  SyncLabelsResponse,
  LinkTagResponse,
  AutoCreateTagsResponse,
} from "./types.js";

export async function getWhatsAppLabels(): Promise<WhatsAppLabel[]> {
  const response = await fetchWithAuth<LabelListResponse>("/labels");
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
  const response = await fetchWithAuth<TagsWithStatusResponse>(
    "/labels/tags/with-status",
  );
  return response.data;
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
