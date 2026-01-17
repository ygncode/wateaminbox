/**
 * Messages API
 * Message related API functions
 */

import type { CreateMessageInput, Message } from "@wateaminbox/shared";
import {
  fetchWithAuth,
  fetchFormDataWithAuth,
  buildQueryString,
} from "./client.js";
import type {
  ApiResponse,
  MessageQueryParams,
  UploadMediaResponse,
} from "./types.js";

export async function getMessages(
  conversationId: string,
  params?: MessageQueryParams,
): Promise<ApiResponse<Message[]>> {
  const query = params
    ? buildQueryString(params as Record<string, unknown>)
    : "";
  return fetchWithAuth<ApiResponse<Message[]>>(
    `/conversations/${conversationId}/messages${query}`,
  );
}

export async function sendMessage(
  conversationId: string,
  data: Omit<CreateMessageInput, "conversationId">,
): Promise<Message> {
  return fetchWithAuth<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  await fetchWithAuth(
    `/conversations/${conversationId}/messages/${messageId}`,
    {
      method: "DELETE",
    },
  );
}

export async function uploadMedia(file: File): Promise<UploadMediaResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return fetchFormDataWithAuth<UploadMediaResponse>("/media/upload", formData);
}
