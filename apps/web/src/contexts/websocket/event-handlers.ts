/**
 * WebSocket event handlers
 *
 * Registers all WebSocket event handlers on a client instance.
 * Extracted from WebSocketProvider for better organization and testability.
 */

import type { QueryClient } from "@tanstack/react-query";
import type {
  ConversationReadPayload,
  MediaDownloadedPayload,
  MediaDownloadFailedPayload,
  Message,
  MessageDeletedPayload,
  MessageStatus,
  MessageStatusPayload,
  NewMessagePayload,
  PaginatedMessages,
  PresencePayload,
  ProfilePicturePayload,
  SyncStatusPayload,
  TypingPayload,
} from "@whatsapp-web/shared";
import { chatKeys } from "../../hooks/useChats";
import { infiniteMessageKeys } from "../../hooks/useInfiniteMessages";
import { markConversationAsRead } from "../../lib/api/conversations";
import type { WebSocketClient } from "../../lib/websocket";
import { wsLogger } from "../../lib/websocket-logger";
import { useChatStore } from "../../stores/chat-store";
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
    (conversationId: string, message: Message) => void
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
  const logger = wsLogger.child("EventHandlers");

  // New message handler
  unsubscribes.push(
    client.on<NewMessagePayload>("message:new", (payload) => {
      logger.debug("New message received in realtime:", {
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
            logger.debug("Duplicate message ignored:", payload.message.id);
            return oldData;
          }

          // Add the new message to the first page (most recent)
          const newPages = [...oldData.pages];
          if (newPages.length > 0) {
            newPages[0] = {
              ...newPages[0],
              messages: [payload.message, ...newPages[0].messages],
            };
            logger.debug(
              "Message added to cache, total messages:",
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
          logger.error("Failed to auto-mark conversation as read:", error);
        });
      }
    }),
  );

  // Message status handler
  unsubscribes.push(
    client.on<MessageStatusPayload>("message:status", (payload) => {
      logger.debug("Message status update:", {
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

  // Note: conversation:updated event is intentionally not handled here.
  // Components can subscribe directly via the WebSocket client if needed.

  // Conversation read handler - invalidate chat list to update unread counts
  unsubscribes.push(
    client.on<ConversationReadPayload>("conversation:read", (payload) => {
      logger.debug("Conversation marked as read:", {
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
    client.on<PresencePayload>("presence:online", (payload) => {
      logger.debug("Contact came online:", payload.jid);

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
    client.on<PresencePayload>("presence:offline", (payload) => {
      logger.debug(
        "Contact went offline:",
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
    client.on<MediaDownloadedPayload>("media:downloaded", (payload) => {
      logger.debug("Media downloaded:", {
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
            logger.debug(
              "No cached data for conversation:",
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
                logger.debug(
                  "Found message to update:",
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
            logger.debug("Message not found in cache:", payload.messageId);
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
    client.on<MediaDownloadFailedPayload>(
      "media:download_failed",
      (payload) => {
        logger.warn("Media download failed:", {
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
              logger.debug(
                "No cached data for conversation:",
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
      },
    ),
  );

  // Sync event handlers
  unsubscribes.push(
    client.on<SyncStatusPayload>("sync:start", (payload) => {
      logger.info("Sync started", payload);
      const connectionId = payload.connectionId || "unknown";
      setSyncingConnections((prev) => {
        const newMap = new Map(prev);
        // Clear interrupted flag if sync is restarting
        newMap.set(connectionId, {
          connectionId,
          conversations: 0,
          startedAt: new Date(),
          interrupted: false,
        });
        return newMap;
      });
    }),
  );

  unsubscribes.push(
    client.on<SyncStatusPayload>("sync:progress", (payload) => {
      logger.debug("Sync progress", payload);
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
      logger.info("Sync completed", payload);
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

  unsubscribes.push(
    client.on<SyncStatusPayload>("sync:interrupted", (payload) => {
      logger.warn("Sync interrupted by disconnection", payload);
      const connectionId = payload.connectionId || "unknown";
      setSyncingConnections((prev) => {
        const newMap = new Map(prev);
        // Keep the sync state but mark it as interrupted
        const existing = newMap.get(connectionId);
        if (existing) {
          newMap.set(connectionId, {
            ...existing,
            interrupted: true,
          });
        }
        return newMap;
      });
    }),
  );

  // Auth success handler (no-op, just acknowledges the event)
  unsubscribes.push(
    client.on("auth_success", () => {
      logger.info("Authentication successful");
    }),
  );

  logger.debug(`Handlers registered: ${unsubscribes.length}`);

  return unsubscribes;
}
