/**
 * Messages API
 * Message related API functions
 */

import type { CreateMessageInput, Message } from "@whatsapp-web/shared"
import {
  fetchWithAuth,
  buildQueryString,
  API_BASE_URL,
  getAccessToken,
  getCompanyId,
  handleResponse,
} from "./client.js"
import type { ApiResponse, MessageQueryParams, UploadMediaResponse } from "./types.js"

export async function getMessages(
  conversationId: string,
  params?: MessageQueryParams
): Promise<ApiResponse<Message[]>> {
  const query = params
    ? buildQueryString(params as Record<string, unknown>)
    : ""
  return fetchWithAuth<ApiResponse<Message[]>>(
    `/conversations/${conversationId}/messages${query}`
  )
}

export async function sendMessage(
  conversationId: string,
  data: Omit<CreateMessageInput, "conversationId">
): Promise<Message> {
  return fetchWithAuth<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  await fetchWithAuth(
    `/conversations/${conversationId}/messages/${messageId}`,
    {
      method: "DELETE",
    }
  )
}

export async function uploadMedia(file: File): Promise<UploadMediaResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const accessToken = getAccessToken()
  const companyId = getCompanyId()

  const headers: Record<string, string> = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (companyId) {
    headers["X-Company-ID"] = companyId
  }

  const response = await fetch(`${API_BASE_URL}/media/upload`, {
    method: "POST",
    headers,
    body: formData,
  })

  return handleResponse<UploadMediaResponse>(response)
}
