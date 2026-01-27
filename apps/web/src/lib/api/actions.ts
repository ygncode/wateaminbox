/**
 * Actions API
 *
 * REST endpoints for real-time actions that were previously handled via WebSocket.
 * These functions call the server to trigger Pusher events.
 */

import { fetchWithAuth } from "./client";
import { getSocketId } from "../pusher";

/**
 * Send a WhatsApp message
 *
 * @param jid - The WhatsApp JID to send to
 * @param content - The message content
 * @param messageType - The type of message (default: "text")
 * @param mediaUrl - Optional media URL for non-text messages
 */
export async function sendMessage(
  jid: string,
  content?: string,
  messageType: "text" | "image" | "audio" | "video" | "document" = "text",
  mediaUrl?: string,
): Promise<{ messageId: string; status: string }> {
  return fetchWithAuth<{ messageId: string; status: string }>(
    "/actions/messages/send",
    {
      method: "POST",
      body: JSON.stringify({
        jid,
        content,
        messageType,
        mediaUrl,
      }),
    },
  );
}

/**
 * Send typing indicator
 *
 * @param conversationId - The conversation ID
 * @param isTyping - Whether the user is typing
 */
export async function sendTypingIndicator(
  conversationId: string,
  isTyping: boolean,
): Promise<void> {
  const socketId = getSocketId();
  const headers: Record<string, string> = {};

  // Include socket ID to exclude self from receiving the event
  if (socketId) {
    headers["X-Pusher-Socket-Id"] = socketId;
  }

  await fetchWithAuth<void>("/actions/messages/typing", {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId,
      isTyping,
    }),
  });
}

/**
 * Broadcast that messages have been read
 *
 * @param conversationId - The conversation ID
 * @param messageIds - Optional list of message IDs that were read
 */
export async function broadcastMessagesRead(
  conversationId: string,
  messageIds?: string[],
): Promise<void> {
  const socketId = getSocketId();
  const headers: Record<string, string> = {};

  if (socketId) {
    headers["X-Pusher-Socket-Id"] = socketId;
  }

  await fetchWithAuth<void>("/actions/messages/read", {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId,
      messageIds,
    }),
  });
}
