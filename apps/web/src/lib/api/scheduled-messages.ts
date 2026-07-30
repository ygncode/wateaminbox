/**
 * Scheduled Messages API
 * Schedule outbound messages for future delivery, list them, and cancel them.
 */

import type { ScheduledMessage } from "@wateaminbox/shared";
import { buildQueryString, fetchWithAuth } from "./client.js";

export interface ScheduleMessageInput {
  contactId: string;
  /** Message text, or the caption when scheduling media (may be empty). */
  content: string;
  messageType?: "text" | "image" | "video" | "document";
  /** Presigned URL from POST /media/upload; required for media types. */
  mediaUrl?: string;
  replyToMessageId?: string;
  /** ISO 8601 timestamp (UTC) for when the message should be sent. */
  scheduledAt: string;
}

export interface ScheduleMessageResponse {
  success: boolean;
  scheduledMessage: ScheduledMessage;
  autoAssigned: boolean;
}

export async function createScheduledMessage(
  input: ScheduleMessageInput,
): Promise<ScheduleMessageResponse> {
  return fetchWithAuth<ScheduleMessageResponse>("/messages/scheduled", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getScheduledMessages(
  contactId: string,
): Promise<ScheduledMessage[]> {
  const response = await fetchWithAuth<{
    success: boolean;
    scheduledMessages: ScheduledMessage[];
  }>(`/messages/scheduled${buildQueryString({ contactId })}`);
  return response.scheduledMessages;
}

export async function cancelScheduledMessage(id: string): Promise<void> {
  await fetchWithAuth<{ success: boolean }>(`/messages/scheduled/${id}`, {
    method: "DELETE",
  });
}
