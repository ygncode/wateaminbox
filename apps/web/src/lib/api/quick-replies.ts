/**
 * Quick Replies API
 * Quick reply template management API functions
 */

import { fetchWithAuth, buildQueryString, ApiRequestError } from "./client.js";
import type {
  QuickReply,
  QuickReplyListParams,
  QuickReplyListResponse,
  CreateQuickReplyInput,
  UpdateQuickReplyInput,
} from "./types.js";

export async function getQuickReplies(
  params?: QuickReplyListParams,
): Promise<QuickReplyListResponse> {
  const query = params
    ? buildQueryString(params as Record<string, unknown>)
    : "";
  return fetchWithAuth<QuickReplyListResponse>(`/quick-replies${query}`);
}

export async function getQuickReplyById(
  quickReplyId: string,
): Promise<QuickReply> {
  const response = await fetchWithAuth<{ data: QuickReply }>(
    `/quick-replies/${quickReplyId}`,
  );
  return response.data;
}

export async function getQuickReplyByShortcut(
  shortcut: string,
): Promise<QuickReply | null> {
  try {
    const response = await fetchWithAuth<{ data: QuickReply }>(
      `/quick-replies/search/${encodeURIComponent(shortcut)}`,
    );
    return response.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function createQuickReply(
  input: CreateQuickReplyInput,
): Promise<QuickReply> {
  const response = await fetchWithAuth<{ data: QuickReply }>("/quick-replies", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateQuickReply(
  quickReplyId: string,
  input: UpdateQuickReplyInput,
): Promise<QuickReply> {
  const response = await fetchWithAuth<{ data: QuickReply }>(
    `/quick-replies/${quickReplyId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function deleteQuickReply(quickReplyId: string): Promise<boolean> {
  const response = await fetchWithAuth<{ data: { deleted: boolean } }>(
    `/quick-replies/${quickReplyId}`,
    {
      method: "DELETE",
    },
  );
  return response.data.deleted;
}
