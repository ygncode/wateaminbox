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
  LabelListResponse,
} from "./types.js";

function withConnection(path: string, connectionId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}connectionId=${encodeURIComponent(connectionId)}`;
}

export async function getWhatsAppLabels(
  connectionId: string,
  limit = 50,
  offset = 0,
): Promise<LabelListResponse> {
  return fetchWithAuth<LabelListResponse>(
    withConnection(`/labels?limit=${limit}&offset=${offset}`, connectionId),
  );
}

export async function getLabelSyncStatus(
  connectionId: string,
): Promise<LabelSyncStatus> {
  return fetchWithAuth<LabelSyncStatus>(
    withConnection("/labels/status", connectionId),
  );
}

export async function getWhatsAppLabel(
  labelId: string,
  connectionId: string,
): Promise<WhatsAppLabel> {
  return fetchWithAuth<WhatsAppLabel>(
    withConnection(`/labels/${labelId}`, connectionId),
  );
}

export async function triggerLabelSync(
  connectionId: string,
): Promise<SyncLabelsResponse> {
  return fetchWithAuth<SyncLabelsResponse>(
    withConnection("/labels/sync", connectionId),
    {
      method: "POST",
    },
  );
}

export async function linkTagToLabel(
  labelId: string,
  tagId: string,
  connectionId: string,
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(
    withConnection(`/labels/${labelId}/link`, connectionId),
    {
      method: "POST",
      body: JSON.stringify({ tagId }),
    },
  );
}

export async function unlinkTagFromLabel(
  labelId: string,
  connectionId: string,
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(
    withConnection(`/labels/${labelId}/link`, connectionId),
    {
      method: "DELETE",
    },
  );
}

export async function autoCreateTagsFromLabels(
  connectionId: string,
): Promise<AutoCreateTagsResponse> {
  return fetchWithAuth<AutoCreateTagsResponse>(
    withConnection("/labels/auto-create", connectionId),
    {
      method: "POST",
    },
  );
}

export async function getTagsWithLabelStatus(
  connectionId: string,
): Promise<TagWithLabelStatus[]> {
  return fetchWithAuth<TagWithLabelStatus[]>(
    withConnection("/labels/tags/with-status", connectionId),
  );
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
