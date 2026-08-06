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
 * Broadcast an ephemeral read receipt for specific messages.
 *
 * NOT the same thing as `markConversationAsRead`, and not a replacement for
 * it. The two read paths are deliberately separate:
 *
 * - `markConversationAsRead` (`POST /conversations/:id/read`) PERSISTS read
 *   state: it zeroes the unread count and records who read it. That is what
 *   the inbox calls when a conversation is opened, and it is the canonical
 *   path.
 * - This one (`POST /actions/messages/read`) persists nothing. It only tells
 *   the conversation's other viewers that these specific `messageIds` were
 *   read, excluding the originating tab.
 *
 * No component calls this yet — the UI marks whole conversations read rather
 * than individual messages. It is kept because per-message receipts are the
 * feature it exists for, and the server route is authorized and covered by
 * `apps/api/src/routes/actions/read.integration.test.ts`. Delete both together
 * if per-message receipts are abandoned.
 *
 * @param conversationId - The tenant contact ID (a UUID, not a JID)
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
