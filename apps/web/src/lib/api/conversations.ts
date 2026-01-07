/**
 * Conversations API
 * Conversation related API functions
 */

import { fetchWithAuth, buildQueryString } from "./client.js"
import type { Conversation, ApiResponse, PaginationParams } from "./types.js"

export async function getConversations(
  params?: PaginationParams
): Promise<ApiResponse<Conversation[]>> {
  const query = params
    ? buildQueryString(params as Record<string, unknown>)
    : ""
  return fetchWithAuth<ApiResponse<Conversation[]>>(`/conversations${query}`)
}

export async function getConversation(
  conversationId: string
): Promise<Conversation> {
  return fetchWithAuth<Conversation>(`/conversations/${conversationId}`)
}

export async function updateConversation(
  conversationId: string,
  data: Partial<Pick<Conversation, "isPinned" | "isMuted" | "assignedUserId">>
): Promise<Conversation> {
  return fetchWithAuth<Conversation>(`/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export async function markConversationAsRead(
  conversationId: string
): Promise<void> {
  await fetchWithAuth(`/conversations/${conversationId}/read`, {
    method: "POST",
  })
}
