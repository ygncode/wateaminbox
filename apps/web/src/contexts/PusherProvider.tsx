/**
 * Pusher Provider
 *
 * Provides real-time communication via Pusher.
 * Central realtime provider for scalable company-scoped events.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ConversationReadPayload,
  MediaDownloadedPayload,
  MediaDownloadFailedPayload,
  MessageDeletedPayload,
  MessageReactionPayload,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  ProfilePicturePayload,
  SyncStatusPayload,
  TypingPayload,
} from "@wateaminbox/shared";
import { useAuth } from "./auth-context";
import {
  bindEvent,
  disconnectPusher,
  getConnectionState,
  initializePusher,
  onConnectionStateChange,
  subscribeToCompany,
  unsubscribeFromCompany,
  type PusherConnectionStatus,
  type PusherEventData,
  type PusherEventType,
} from "../lib/pusher";
import { sendTypingIndicator, broadcastMessagesRead } from "../lib/api/actions";
import { markConversationAsRead } from "../lib/api/conversations";
import { api } from "../lib/api";
import { useChatStore } from "../stores/chat-store";
import type { TypingIndicator } from "../stores/chat-store";
import {
  addMessageToCache,
  invalidateChatList,
  refetchConversationMessages,
  updateContactInChatList,
  updateMessageInCache,
} from "./realtime/cache-utils";

// Typing timeout in milliseconds
const TYPING_TIMEOUT = 5000;

/**
 * Sync state for a connection
 */
export interface SyncState {
  connectionId: string;
  conversations: number;
  startedAt: Date;
  interrupted?: boolean;
}

/**
 * Event handler type for subscribe function (backward compatibility)
 */
type EventHandler<T = unknown> = (payload: T) => void;

/**
 * Context value for Pusher provider
 */
export interface PusherContextValue {
  // Connection state
  status: PusherConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;

  // Sync state
  syncingConnections: Map<string, SyncState>;
  clearSyncingConnections: () => void;

  // Connection methods
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;

  // Event subscription
  subscribe: <T>(eventType: string, handler: EventHandler<T>) => () => void;

  // Messaging methods
  sendTypingStart: (conversationId: string) => void;
  sendTypingStop: (conversationId: string) => void;
  sendMarkAsRead: (conversationId: string, messageIds: string[]) => void;
}

interface PusherProviderProps {
  children: React.ReactNode;
  autoConnect?: boolean;
}

const PusherContext = createContext<PusherContextValue | null>(null);

export function PusherProvider({
  children,
  autoConnect = true,
}: PusherProviderProps) {
  const [status, setStatus] = useState<PusherConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [syncingConnections, setSyncingConnections] = useState<
    Map<string, SyncState>
  >(new Map());

  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const isInitializedRef = useRef(false);
  const eventUnsubscribesRef = useRef<(() => void)[]>([]);

  // Get current company ID from auth context
  const { currentCompanyId } = useAuth();

  // TanStack Query client for cache updates
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  // Chat store callbacks - use refs to avoid dependency cycles
  const addMessageRef = useRef(useChatStore.getState().addMessage);
  const updateMessageStatusRef = useRef(
    useChatStore.getState().updateMessageStatus,
  );
  const addTypingIndicatorRef = useRef(
    useChatStore.getState().addTypingIndicator,
  );
  const removeTypingIndicatorRef = useRef(
    useChatStore.getState().removeTypingIndicator,
  );

  // Update refs when store changes
  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      addMessageRef.current = state.addMessage;
      updateMessageStatusRef.current = state.updateMessageStatus;
      addTypingIndicatorRef.current = state.addTypingIndicator;
      removeTypingIndicatorRef.current = state.removeTypingIndicator;
    });
    return unsub;
  }, []);

  // Helper to manage typing timeout
  const setTypingTimeout = useCallback(
    (conversationId: string, userId: string) => {
      const key = `${conversationId}:${userId}`;

      // Clear existing timeout
      const existingTimeout = typingTimeoutsRef.current.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Set new timeout
      const timeout = setTimeout(() => {
        removeTypingIndicatorRef.current(conversationId, userId);
        typingTimeoutsRef.current.delete(key);
      }, TYPING_TIMEOUT);

      typingTimeoutsRef.current.set(key, timeout);
    },
    [],
  );

  // Clear typing timeout
  const clearTypingTimeout = useCallback(
    (conversationId: string, userId: string) => {
      const key = `${conversationId}:${userId}`;
      const timeout = typingTimeoutsRef.current.get(key);
      if (timeout) {
        clearTimeout(timeout);
        typingTimeoutsRef.current.delete(key);
      }
    },
    [],
  );

  // Register all Pusher event handlers
  const registerEventHandlers = useCallback(() => {
    // Clean up existing handlers
    eventUnsubscribesRef.current.forEach((unsub) => unsub());
    eventUnsubscribesRef.current = [];

    const qc = queryClientRef.current;

    // New message handler
    eventUnsubscribesRef.current.push(
      bindEvent<NewMessagePayload>("message:new", (data) => {
        const payload = data.payload;
        console.log("[Pusher] message:new received:", payload.message.id);

        // Update Zustand store
        addMessageRef.current(payload.conversationId, payload.message);

        // Update TanStack Query cache
        addMessageToCache(qc, payload.conversationId, payload.message);

        // Invalidate chat list for unread counts
        invalidateChatList(qc);

        // Auto-mark as read if viewing this conversation
        const selectedId = useChatStore.getState().selectedConversationId;
        if (
          selectedId === payload.conversationId &&
          payload.message.senderType === "contact"
        ) {
          markConversationAsRead(payload.conversationId).catch(console.error);
        }
      }),
    );

    // Message status handler
    eventUnsubscribesRef.current.push(
      bindEvent<MessageStatusPayload>("message:status", (data) => {
        const payload = data.payload;
        updateMessageStatusRef.current(
          payload.conversationId,
          payload.messageId,
          payload.status,
        );
        updateMessageInCache(
          qc,
          payload.conversationId,
          payload.messageId,
          (msg) => ({
          ...msg,
          status: payload.status,
          }),
        );
      }),
    );

    // Message reaction handler
    eventUnsubscribesRef.current.push(
      bindEvent<MessageReactionPayload>("message:reaction", (data) => {
        const payload = data.payload;
        updateMessageInCache(
          qc,
          payload.contactId,
          payload.messageId,
          (msg) => {
          const reactions = msg.reactions || [];
          if (!payload.emoji) {
            return {
              ...msg,
                reactions: reactions.filter(
                  (r) => r.reactorJid !== payload.from,
                ),
            };
          }
          const existingIdx = reactions.findIndex(
            (r) => r.reactorJid === payload.from,
          );
          if (existingIdx >= 0) {
            const updated = [...reactions];
            updated[existingIdx] = {
              ...updated[existingIdx],
              emoji: payload.emoji,
              createdAt: new Date(),
            };
            return { ...msg, reactions: updated };
          }
          return {
            ...msg,
            reactions: [
              ...reactions,
                {
                  emoji: payload.emoji,
                  reactorJid: payload.from,
                  createdAt: new Date(),
                },
            ],
          };
          },
        );
      }),
    );

    // Typing handlers
    eventUnsubscribesRef.current.push(
      bindEvent<TypingPayload>("typing:start", (data) => {
        const payload = data.payload;
        const indicator: TypingIndicator = {
          conversationId: payload.conversationId,
          userId: payload.userId,
          userName: payload.userName,
          startedAt: new Date(),
        };
        addTypingIndicatorRef.current(indicator);
        setTypingTimeout(payload.conversationId, payload.userId);
      }),
    );

    eventUnsubscribesRef.current.push(
      bindEvent<TypingPayload>("typing:stop", (data) => {
        const payload = data.payload;
        removeTypingIndicatorRef.current(
          payload.conversationId,
          payload.userId,
        );
        clearTypingTimeout(payload.conversationId, payload.userId);
      }),
    );

    // Conversation/contact changes can affect filters, assignments, unread
    // counts, and sidebar previews, so refresh the chat list.
    eventUnsubscribesRef.current.push(
      bindEvent<ConversationReadPayload>("conversation:read", () => {
        invalidateChatList(qc);
      }),
      bindEvent("conversation:updated", () => {
        invalidateChatList(qc);
      }),
      bindEvent("contact:updated", () => {
        invalidateChatList(qc);
      }),
    );

    // Profile picture handler
    eventUnsubscribesRef.current.push(
      bindEvent<ProfilePicturePayload>("contact:profile_picture", (data) => {
        const payload = data.payload;
        updateContactInChatList(qc, payload.jid, (contact) => ({
          ...contact,
          avatarUrl: payload.profilePictureUrl,
        }));
      }),
    );

    // Message deleted handler
    eventUnsubscribesRef.current.push(
      bindEvent<MessageDeletedPayload>("message:deleted", (data) => {
        const payload = data.payload;
        updateMessageInCache(
          qc,
          payload.conversationId,
          payload.messageId,
          (msg) => ({
          ...msg,
          deleted_by_sender: true,
          deleted_at: new Date().toISOString(),
          }),
        );
      }),
    );

    // Presence handlers
    eventUnsubscribesRef.current.push(
      bindEvent<PresencePayload>("presence:online", (data) => {
        updateContactInChatList(qc, data.payload.jid, (contact) => ({
          ...contact,
          isOnline: true,
          lastSeen: null,
        }));
      }),
    );

    eventUnsubscribesRef.current.push(
      bindEvent<PresencePayload>("presence:offline", (data) => {
        const payload = data.payload;
        updateContactInChatList(qc, payload.jid, (contact) => ({
          ...contact,
          isOnline: false,
          lastSeen: payload.lastSeen ? new Date(payload.lastSeen) : undefined,
        }));
      }),
    );

    // Media handlers
    eventUnsubscribesRef.current.push(
      bindEvent<MediaDownloadedPayload>("media:downloaded", (data) => {
        const payload = data.payload;
        updateMessageInCache(
          qc,
          payload.conversationId,
          payload.messageId,
          (msg) => ({
          ...msg,
          metadata: {
            ...(msg.metadata || {}),
            mediaUrl: payload.mediaUrl,
            mediaPending: false,
            mediaDownloadStatus: "completed" as const,
            fileSize: payload.mediaSize || msg.metadata?.fileSize,
          },
          }),
        );
        refetchConversationMessages(qc, payload.conversationId);
      }),
    );

    eventUnsubscribesRef.current.push(
      bindEvent<MediaDownloadFailedPayload>("media:download_failed", (data) => {
        const payload = data.payload;
        updateMessageInCache(
          qc,
          payload.conversationId,
          payload.messageId,
          (msg) => ({
          ...msg,
          metadata: {
            ...(msg.metadata || {}),
            mediaPending: true,
            mediaDownloadStatus: "failed" as const,
          },
          }),
        );
        refetchConversationMessages(qc, payload.conversationId);
      }),
    );

    // Sync handlers
    eventUnsubscribesRef.current.push(
      bindEvent<SyncStatusPayload>("sync:start", (data) => {
        const connectionId = data.connectionId || "unknown";
        setSyncingConnections((prev) => {
          const newMap = new Map(prev);
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

    eventUnsubscribesRef.current.push(
      bindEvent<SyncStatusPayload>("sync:progress", (data) => {
        const payload = data.payload;
        const connectionId = data.connectionId || "unknown";
        setSyncingConnections((prev) => {
          const newMap = new Map(prev);
          const existing = newMap.get(connectionId);
          newMap.set(connectionId, {
            connectionId,
            conversations: payload.conversations,
            startedAt: existing?.startedAt || new Date(),
          });
          return newMap;
        });
      }),
    );

    eventUnsubscribesRef.current.push(
      bindEvent<SyncStatusPayload>("sync:complete", (data) => {
        const connectionId = data.connectionId || "unknown";
        setSyncingConnections((prev) => {
          const newMap = new Map(prev);
          newMap.delete(connectionId);
          return newMap;
        });
        invalidateChatList(qc);
      }),
    );

    eventUnsubscribesRef.current.push(
      bindEvent<SyncStatusPayload>("sync:interrupted", (data) => {
        const connectionId = data.connectionId || "unknown";
        setSyncingConnections((prev) => {
          const newMap = new Map(prev);
          const existing = newMap.get(connectionId);
          if (existing) {
            newMap.set(connectionId, { ...existing, interrupted: true });
          }
          return newMap;
        });
      }),
    );

    console.log("[Pusher] Event handlers registered");
  }, [setTypingTimeout, clearTypingTimeout]);

  // Connect to Pusher
  const connect = useCallback(() => {
    if (!currentCompanyId) {
      console.warn("[Pusher] Cannot connect: no company ID");
      return;
    }

    try {
    initializePusher();
    subscribeToCompany(currentCompanyId);
    registerEventHandlers();
    } catch (connectionError) {
      setStatus("failed");
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : "Realtime connection failed",
      );
      return;
    }

    // Set up connection state listener
    const unsub = onConnectionStateChange((state) => {
      setStatus(state);
      if (state === "connected") {
        setError(null);
      } else if (state === "failed" || state === "unavailable") {
        setError("Connection failed");
      }
    });

    eventUnsubscribesRef.current.push(unsub);

    // Set initial state
    setStatus(getConnectionState());
  }, [currentCompanyId, registerEventHandlers]);

  // Disconnect from Pusher
  const disconnect = useCallback(() => {
    eventUnsubscribesRef.current.forEach((unsub) => unsub());
    eventUnsubscribesRef.current = [];
    unsubscribeFromCompany();
    setStatus("disconnected");
  }, []);

  // Reconnect to Pusher
  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect, disconnect]);

  // Clear syncing connections
  const clearSyncingConnections = useCallback(() => {
    setSyncingConnections(new Map());
  }, []);

  // Fetch initial sync status
  const fetchSyncStatus = useCallback(async () => {
    if (!currentCompanyId) return;

    try {
      const response = await api.get<{
        connections: Array<{
          id: string;
          sync_status: string | null;
          updated_at: string | null;
        }>;
      }>("/whatsapp/sync-status");

      const newMap = new Map<string, SyncState>();
      for (const conn of response.connections) {
        if (conn.sync_status === "syncing") {
          newMap.set(conn.id, {
            connectionId: conn.id,
            conversations: 0,
            startedAt: conn.updated_at ? new Date(conn.updated_at) : new Date(),
          });
        }
      }
      setSyncingConnections(newMap);
    } catch (err) {
      console.warn("[Pusher] Failed to fetch sync status:", err);
    }
  }, [currentCompanyId]);

  // Send typing indicator via REST
  const sendTypingStart = useCallback((conversationId: string) => {
      sendTypingIndicator(conversationId, true).catch(console.error);
  }, []);

  const sendTypingStop = useCallback((conversationId: string) => {
      sendTypingIndicator(conversationId, false).catch(console.error);
  }, []);

  // Mark messages as read
  const sendMarkAsRead = useCallback(
    (conversationId: string, messageIds: string[]) => {
      broadcastMessagesRead(conversationId, messageIds).catch(console.error);
    },
    [],
  );

  // Allow feature hooks to listen for specific company events.
  const subscribe = useCallback(
    <T,>(eventType: string, handler: EventHandler<T>): (() => void) => {
      // Wrap the handler to extract payload from PusherEventData
      const wrappedHandler = (data: PusherEventData<T>) => {
        // Include the connection ID in payloads consumed by connection hooks.
        const payload = {
          ...data.payload,
          connectionId: data.connectionId,
        } as T;
        handler(payload);
      };

      return bindEvent(eventType as PusherEventType, wrappedHandler);
    },
    [],
  );

  // Initialize on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    if (autoConnect && currentCompanyId) {
      connect();
      fetchSyncStatus();
    }

    return () => {
      eventUnsubscribesRef.current.forEach((unsub) => unsub());
      eventUnsubscribesRef.current = [];
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      typingTimeoutsRef.current.clear();
      disconnectPusher();
      isInitializedRef.current = false;
    };
  }, [autoConnect, connect, currentCompanyId, fetchSyncStatus]);

  // Re-fetch sync status on reconnect
  useEffect(() => {
    if (status === "connected") {
      fetchSyncStatus();
    }
  }, [status, fetchSyncStatus]);

  const contextValue: PusherContextValue = {
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    error,
    syncingConnections,
    clearSyncingConnections,
    connect,
    disconnect,
    reconnect,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
  };

  return (
    <PusherContext.Provider value={contextValue}>
      {children}
    </PusherContext.Provider>
  );
}

/**
 * Hook to use Pusher context
 */
export function usePusherContext(): PusherContextValue {
  const context = useContext(PusherContext);
  if (!context) {
    throw new Error("usePusherContext must be used within a PusherProvider");
  }
  return context;
}

export { PusherProvider as RealtimeProvider };
export { usePusherContext as useRealtimeContext };
export type { PusherContextValue as RealtimeContextValue };
