/**
 * Actions API
 *
 * REST endpoints for real-time actions that were previously handled via WebSocket.
 * These functions call the server to trigger realtime events.
 */

import { getRealtimeClientId } from "../realtime";
import { fetchWithAuth } from "./client";

/**
 * Send typing indicator
 *
 * @param conversationId - The conversation ID
 * @param isTyping - Whether the user is typing
 */
export async function sendTypingIndicator(
  conversationId: string,
  contactId: string,
  isTyping: boolean,
): Promise<void> {
  const clientId = getRealtimeClientId();
  const headers: Record<string, string> = {};

  // Include the Centrifugo client ID to exclude this connection.
  if (clientId) {
    headers["X-Realtime-Client-Id"] = clientId;
  }

  await fetchWithAuth<void>("/actions/messages/typing", {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId,
      contactId,
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
  const clientId = getRealtimeClientId();
  const headers: Record<string, string> = {};

  if (clientId) {
    headers["X-Realtime-Client-Id"] = clientId;
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
