/**
 * WebSocket event handlers
 *
 * Registers all WebSocket event handlers on a client instance.
 * Extracted from WebSocketProvider for better organization and testability.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { MessageStatus, PaginatedMessages } from "@whatsapp-web/shared";
import { chatKeys } from "../../hooks/useChats";
import { infiniteMessageKeys } from "../../hooks/useInfiniteMessages";
import { markConversationAsRead } from "../../lib/api/conversations";
import { useChatStore } from "../../stores/chat-store";
import type {
  ConversationReadPayload,
  ConversationUpdatedPayload,
  MessageDeletedPayload,
  MessageStatusPayload,
  NewMessagePayload,
  ProfilePicturePayload,
  SyncStatusPayload,
  TypingPayload,
  WebSocketClient,
} from "../../lib/websocket";
import type { TypingIndicator } from "../../stores/chat-store";
import type { SyncState } from "./types";

/** Typed infinite query data structure */
type InfiniteMessageData = {
  pages: PaginatedMessages[];
  pageParams: (string | undefined)[];
};

/**
 * Callback refs needed by event handlers
 */
interface HandlerCallbacks {
  addMessageRef: React.MutableRefObject<
    (conversationId: string, message: any) => void
  >;
  updateMessageStatusRef: React.MutableRefObject<
    (conversationId: string, messageId: string, status: MessageStatus) => void
  >;
  addTypingIndicatorRef: React.MutableRefObject<
    (indicator: TypingIndicator) => void
  >;
  removeTypingIndicatorRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >;
  setTypingTimeoutRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >;
  clearTypingTimeoutRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >;
}

/**
 * Register all WebSocket event handlers on a client
 *
 * @param client - WebSocket client instance
 * @param queryClientRef - React Query client ref
 * @param setSyncingConnections - State setter for syncing connections
 * @param callbacks - Callback refs for store updates
 * @returns Array of unsubscribe functions
 */
export function registerEventHandlers(
  client: WebSocketClient,
  queryClientRef: React.MutableRefObject<QueryClient>,
  setSyncingConnections: React.Dispatch<
    React.SetStateAction<Map<string, SyncState>>
  >,
  callbacks: HandlerCallbacks,
): (() => void)[] {
  const {
    addMessageRef,
    updateMessageStatusRef,
    addTypingIndicatorRef,
    removeTypingIndicatorRef,
    setTypingTimeoutRef,
    clearTypingTimeoutRef,
  } = callbacks;

  const unsubscribes: (() => void)[] = [];

  // New message handler
  unsubscribes.push(
    client.on<NewMessagePayload>("message:new", (payload) => {
      console.log("[WebSocket] 💬 New message received in realtime:", {
        messageId: payload.message.id,
        conversationId: payload.conversationId,
        content: payload.message.content?.substring(0, 50),
        senderType: payload.message.senderType,
      });

      // Update Zustand store (for legacy compatibility)
      addMessageRef.current(payload.conversationId, payload.message);

      // Update TanStack Query cache for real-time message updates
      const queryKey = infiniteMessageKeys.list(payload.conversationId);
      queryClientRef.current.setQueryData(
        queryKey,
        (oldData: InfiniteMessageData | undefined) => {
          if (!oldData) return oldData;

          // Check if message already exists to avoid duplicates
          const messageExists = oldData.pages.some((page: any) =>
            page.messages.some((msg: any) => msg.id === payload.message.id),
          );
          if (messageExists) {
            console.log(
              "[WebSocket] ⚠️ Duplicate message ignored:",
              payload.message.id,
            );
            return oldData;
          }

          // Add the new message to the first page (most recent)
          const newPages = [...oldData.pages];
          if (newPages.length > 0) {
            newPages[0] = {
              ...newPages[0],
              messages: [payload.message, ...newPages[0].messages],
            };
            console.log(
              "[WebSocket] ✅ Message added to cache, total messages:",
              newPages.reduce(
                (sum: number, page: any) => sum + page.messages.length,
                0,
              ),
            );
          }

          return {
            ...oldData,
            pages: newPages,
          };
        },
      );

      // Read store state FIRST before any async operations can change it
      const selectedConversationId =
        useChatStore.getState().selectedConversationId;
      const shouldAutoMark =
        selectedConversationId === payload.conversationId &&
        payload.message.senderType === "contact";

      // Invalidate chat list queries to update unread count badges
      queryClientRef.current.invalidateQueries({
        queryKey: chatKeys.lists(),
      });

      // Auto-mark as read if user was actively viewing this conversation
      if (shouldAutoMark) {
        markConversationAsRead(payload.conversationId).catch((error) => {
          console.error(
            "[WebSocket] Failed to auto-mark conversation as read:",
            error,
          );
        });
      }
    }),
  );

  // Message status handler
  unsubscribes.push(
    client.on<MessageStatusPayload>("message:status", (payload) => {
      console.log("[WebSocket] 📬 Message status update:", {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        status: payload.status,
      });

      // Update Zustand store (for legacy compatibility)
      updateMessageStatusRef.current(
        payload.conversationId,
        payload.messageId,
        payload.status,
      );

      // Update TanStack Query cache for real-time status updates
      const queryKey = infiniteMessageKeys.list(payload.conversationId);
      queryClientRef.current.setQueryData(
        queryKey,
        (oldData: InfiniteMessageData | undefined) => {
          if (!oldData) return oldData;

          // Find and update the message status in all pages
          const newPages = oldData.pages.map((page: any) => ({
            ...page,
            messages: page.messages.map((msg: any) =>
              msg.id === payload.messageId
                ? { ...msg, status: payload.status }
                : msg,
            ),
          }));

          return {
            ...oldData,
            pages: newPages,
          };
        },
      );
    }),
  );

  // Typing start handler
  unsubscribes.push(
    client.on<TypingPayload>("typing:start", (payload) => {
      const indicator: TypingIndicator = {
        conversationId: payload.conversationId,
        userId: payload.userId,
        userName: payload.userName,
        startedAt: new Date(),
      };
      addTypingIndicatorRef.current(indicator);
      setTypingTimeoutRef.current(payload.conversationId, payload.userId);
    }),
  );

  // Typing stop handler
  unsubscribes.push(
    client.on<TypingPayload>("typing:stop", (payload) => {
      removeTypingIndicatorRef.current(payload.conversationId, payload.userId);
      clearTypingTimeoutRef.current(payload.conversationId, payload.userId);
    }),
  );

  // Conversation updated handler (can be used by consumers)
  unsubscribes.push(
    client.on<ConversationUpdatedPayload>("conversation:updated", () => {
      // This event can be handled by individual components via subscribe
    }),
  );

  // Conversation read handler - invalidate chat list to update unread counts
  unsubscribes.push(
    client.on<ConversationReadPayload>("conversation:read", (payload) => {
      console.log("[WebSocket] 📖 Conversation marked as read:", {
        contactId: payload.contactId,
        readBy: payload.readBy,
      });

      // Invalidate chat list queries to update unread count badges
      queryClientRef.current.invalidateQueries({
        queryKey: chatKeys.lists(),
      });
    }),
  );

  // Profile picture handler
  unsubscribes.push(
    client.on<ProfilePicturePayload>("contact:profile_picture", (payload) => {
      // Update chat list cache
      queryClientRef.current.setQueriesData(
        { queryKey: chatKeys.lists() },
        (oldData: any) => {
          if (!oldData) return oldData;
          return oldData.map((chat: any) => {
            if (chat.contact?.jid === payload.jid) {
              return {
                ...chat,
                contact: {
                  ...chat.contact,
                  avatarUrl: payload.profilePictureUrl,
                },
              };
            }
            return chat;
          });
        },
      );

      // Update individual contact details cache
      queryClientRef.current
        .getQueriesData({ queryKey: ["contact"] })
        .forEach(([queryKey, oldData]: [any, any]) => {
          if (oldData && oldData.jid === payload.jid) {
            queryClientRef.current.setQueryData(queryKey, {
              ...oldData,
              profilePictureUrl: payload.profilePictureUrl,
            });
          }
        });
    }),
  );

  // Message deleted handler
  unsubscribes.push(
    client.on<MessageDeletedPayload>("message:deleted", (payload) => {
      // Update TanStack Query cache to mark the message as deleted
      const queryKey = infiniteMessageKeys.list(payload.conversationId);
      queryClientRef.current.setQueryData(
        queryKey,
        (oldData: InfiniteMessageData | undefined) => {
          if (!oldData) return oldData;

          // Find and update the message in all pages
          const newPages = oldData.pages.map((page: any) => ({
            ...page,
            messages: page.messages.map((msg: any) =>
              msg.id === payload.messageId
                ? {
                    ...msg,
                    deleted_by_sender: true,
                    deleted_at: new Date().toISOString(),
                  }
                : msg,
            ),
          }));

          return {
            ...oldData,
            pages: newPages,
          };
        },
      );
    }),
  );

  // Presence online handler
  unsubscribes.push(
    client.on<{
      jid: string;
      isOnline: boolean;
      lastSeen?: string;
    }>("presence:online", (payload) => {
      console.log("[WebSocket] ✅ Contact came online:", payload.jid);

      // Update chat list cache
      queryClientRef.current.setQueriesData(
        { queryKey: chatKeys.lists() },
        (oldData: any) => {
          if (!oldData) return oldData;
          return oldData.map((chat: any) => {
            if (chat.contact?.jid === payload.jid) {
              return {
                ...chat,
                contact: {
                  ...chat.contact,
                  isOnline: true,
                  lastSeen: null,
                },
              };
            }
            return chat;
          });
        },
      );
    }),
  );

  // Presence offline handler
  unsubscribes.push(
    client.on<{
      jid: string;
      isOnline: boolean;
      lastSeen?: string;
    }>("presence:offline", (payload) => {
      console.log(
        "[WebSocket] 🔴 Contact went offline:",
        payload.jid,
        "last seen:",
        payload.lastSeen,
      );

      // Update chat list cache
      queryClientRef.current.setQueriesData(
        { queryKey: chatKeys.lists() },
        (oldData: any) => {
          if (!oldData) return oldData;
          return oldData.map((chat: any) => {
            if (chat.contact?.jid === payload.jid) {
              return {
                ...chat,
                contact: {
                  ...chat.contact,
                  isOnline: false,
                  lastSeen: payload.lastSeen
                    ? new Date(payload.lastSeen)
                    : undefined,
                },
              };
            }
            return chat;
          });
        },
      );
    }),
  );

  // Media downloaded handler - update message with downloaded media URL
  unsubscribes.push(
    client.on<{
      messageId: string;
      conversationId: string;
      mediaUrl: string;
      mediaSize?: number;
    }>("media:downloaded", (payload) => {
      console.log("[WebSocket] 📥 Media downloaded:", {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        mediaUrl: payload.mediaUrl,
      });

      // Update TanStack Query cache with downloaded media
      const queryKey = infiniteMessageKeys.list(payload.conversationId);
      let messageFound = false;

      queryClientRef.current.setQueryData(
        queryKey,
        (oldData: InfiniteMessageData | undefined) => {
          if (!oldData) {
            console.log(
              "[WebSocket] ⚠️ No cached data for conversation:",
              payload.conversationId,
            );
            return oldData;
          }

          // Find and update the message with the downloaded media URL
          const newPages = oldData.pages.map((page: any) => ({
            ...page,
            messages: page.messages.map((msg: any) => {
              if (msg.id === payload.messageId) {
                messageFound = true;
                console.log(
                  "[WebSocket] ✅ Found message to update:",
                  msg.id,
                  "old mediaUrl:",
                  msg.metadata?.mediaUrl,
                );
                return {
                  ...msg,
                  metadata: {
                    ...msg.metadata,
                    mediaUrl: payload.mediaUrl,
                    mediaPending: false,
                    mediaDownloadStatus: "completed" as const,
                    fileSize: payload.mediaSize || msg.metadata?.fileSize,
                  },
                };
              }
              return msg;
            }),
          }));

          if (!messageFound) {
            console.log(
              "[WebSocket] ⚠️ Message not found in cache:",
              payload.messageId,
            );
          }

          return {
            ...oldData,
            pages: newPages,
          };
        },
      );

      // Force refetch to ensure UI updates immediately
      queryClientRef.current.refetchQueries({
        queryKey: queryKey,
        type: "active",
      });
    }),
  );

  // Media download failed handler
  unsubscribes.push(
    client.on<{
      messageId: string;
      conversationId: string;
      error?: string;
    }>("media:download_failed", (payload) => {
      console.log("[WebSocket] ❌ Media download failed:", {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        error: payload.error,
      });

      // Update TanStack Query cache with failed status
      const queryKey = infiniteMessageKeys.list(payload.conversationId);
      queryClientRef.current.setQueryData(
        queryKey,
        (oldData: InfiniteMessageData | undefined) => {
          if (!oldData) {
            console.log(
              "[WebSocket] ⚠️ No cached data for conversation:",
              payload.conversationId,
            );
            return oldData;
          }

          const newPages = oldData.pages.map((page: any) => ({
            ...page,
            messages: page.messages.map((msg: any) =>
              msg.id === payload.messageId
                ? {
                    ...msg,
                    metadata: {
                      ...msg.metadata,
                      mediaPending: true,
                      mediaDownloadStatus: "failed" as const,
                    },
                  }
                : msg,
            ),
          }));

          return {
            ...oldData,
            pages: newPages,
          };
        },
      );

      // Force refetch to ensure UI updates immediately
      queryClientRef.current.refetchQueries({
        queryKey: queryKey,
        type: "active",
      });
    }),
  );

  // Sync event handlers
  unsubscribes.push(
    client.on<SyncStatusPayload>("sync:start", (payload) => {
      console.log("[WebSocket] 🔄 Sync started", payload);
      const connectionId = payload.connectionId || "unknown";
      setSyncingConnections((prev) => {
        const newMap = new Map(prev);
        newMap.set(connectionId, {
          connectionId,
          conversations: 0,
          startedAt: new Date(),
        });
        return newMap;
      });
    }),
  );

  unsubscribes.push(
    client.on<SyncStatusPayload>("sync:progress", (payload) => {
      console.log("[WebSocket] 🔄 Sync progress", payload);
      const connectionId = payload.connectionId || "unknown";
      setSyncingConnections((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(connectionId);
        // Create entry if it doesn't exist (in case sync:start was missed)
        newMap.set(connectionId, {
          connectionId,
          conversations: payload.conversations,
          startedAt: existing?.startedAt || new Date(),
        });
        return newMap;
      });
    }),
  );

  unsubscribes.push(
    client.on<SyncStatusPayload>("sync:complete", (payload) => {
      console.log("[WebSocket] ✅ Sync completed", payload);
      const connectionId = payload.connectionId || "unknown";
      setSyncingConnections((prev) => {
        const newMap = new Map(prev);
        newMap.delete(connectionId);
        return newMap;
      });
      // Invalidate chat list to show new contacts
      queryClientRef.current.invalidateQueries({
        queryKey: chatKeys.lists(),
      });
    }),
  );

  // Auth success handler (no-op, just acknowledges the event)
  unsubscribes.push(
    client.on("auth_success", () => {
      console.log("[WebSocket] ✅ Authentication successful");
    }),
  );

  console.log("[WebSocket] ✅ Handlers registered:", unsubscribes.length);

  return unsubscribes;
}
