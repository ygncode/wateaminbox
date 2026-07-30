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

export async function getQuickReplyLibrary(): Promise<QuickReply[]> {
  const quickReplies: QuickReply[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const page = await getQuickReplies({ limit, offset });
    quickReplies.push(...page.data);

    if (!page.pagination.hasMore || page.data.length === 0) {
      return quickReplies;
    }

    offset += limit;
  }
}

export async function getQuickReplyById(
  quickReplyId: string,
): Promise<QuickReply> {
  return fetchWithAuth<QuickReply>(`/quick-replies/${quickReplyId}`);
}

export async function getQuickReplyByShortcut(
  shortcut: string,
): Promise<QuickReply | null> {
  try {
    return await fetchWithAuth<QuickReply>(
      `/quick-replies/search/${encodeURIComponent(shortcut)}`,
    );
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
  return fetchWithAuth<QuickReply>("/quick-replies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateQuickReply(
  quickReplyId: string,
  input: UpdateQuickReplyInput,
): Promise<QuickReply> {
  return fetchWithAuth<QuickReply>(`/quick-replies/${quickReplyId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteQuickReply(quickReplyId: string): Promise<void> {
  await fetchWithAuth<{ message: string }>(`/quick-replies/${quickReplyId}`, {
    method: "DELETE",
  });
}
