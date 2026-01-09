import { useEffect } from "react";
import type { MessageReactionPayload } from "../../lib/websocket";
import { useChatStore } from "../../stores/chat-store";
import type {
  ConversationUpdatedPayload,
  ErrorPayload,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  TypingPayload,
  WebSocketClient,
  WhatsAppTypingPayload,
} from "./types";

interface UseWebSocketEventsOptions {
  onNewMessage?: (payload: NewMessagePayload) => void;
  onMessageStatus?: (payload: MessageStatusPayload) => void;
  onTypingStart?: (payload: TypingPayload) => void;
  onTypingStop?: (payload: TypingPayload) => void;
  onPresenceChange?: (payload: PresencePayload) => void;
  onConversationUpdated?: (payload: ConversationUpdatedPayload) => void;
  onError?: (payload: ErrorPayload) => void;
}

interface UseWebSocketEventsDeps {
  getClient: () => WebSocketClient;
  handleTypingStart: (
    payload: TypingPayload | WhatsAppTypingPayload,
    onTypingStart?: (payload: TypingPayload) => void,
  ) => void;
  handleTypingStop: (
    payload: TypingPayload | WhatsAppTypingPayload,
    onTypingStop?: (payload: TypingPayload) => void,
  ) => void;
  setError: (error: string | null) => void;
}

/**
 * Hook for setting up WebSocket event subscriptions.
 * Handles message, typing, presence, and error events.
 */
export function useWebSocketEvents(
  options: UseWebSocketEventsOptions,
  deps: UseWebSocketEventsDeps,
) {
  const { getClient, handleTypingStart, handleTypingStop, setError } = deps;

  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessageStatus = useChatStore(
    (state) => state.updateMessageStatus,
  );
  const updateMessageReaction = useChatStore(
    (state) => state.updateMessageReaction,
  );

  useEffect(() => {
    const client = getClient();

    // New message handler
    const unsubNewMessage = client.on<NewMessagePayload>(
      "message:new",
      (payload) => {
        addMessage(payload.conversationId, payload.message);
        options.onNewMessage?.(payload);
      },
    );

    // Message status handler
    const unsubMessageStatus = client.on<MessageStatusPayload>(
      "message:status",
      (payload) => {
        updateMessageStatus(
          payload.conversationId,
          payload.messageId,
          payload.status,
        );
        options.onMessageStatus?.(payload);
      },
    );

    // Message reaction handler
    const unsubMessageReaction = client.on<MessageReactionPayload>(
      "message:reaction",
      (payload) => {
        updateMessageReaction(
          payload.contactId,
          payload.messageId,
          payload.from,
          payload.emoji,
        );
      },
    );

    // Typing start handler
    const unsubTypingStart = client.on<TypingPayload | WhatsAppTypingPayload>(
      "typing:start",
      (payload) => {
        handleTypingStart(payload, options.onTypingStart);
      },
    );

    // Typing stop handler
    const unsubTypingStop = client.on<TypingPayload | WhatsAppTypingPayload>(
      "typing:stop",
      (payload) => {
        handleTypingStop(payload, options.onTypingStop);
      },
    );

    // Presence handlers
    const unsubPresenceOnline = client.on<PresencePayload>(
      "presence:online",
      (payload) => {
        options.onPresenceChange?.(payload);
      },
    );

    const unsubPresenceOffline = client.on<PresencePayload>(
      "presence:offline",
      (payload) => {
        options.onPresenceChange?.(payload);
      },
    );

    // Conversation updated handler
    const unsubConversationUpdated = client.on<ConversationUpdatedPayload>(
      "conversation:updated",
      (payload) => {
        options.onConversationUpdated?.(payload);
      },
    );

    // Error handler
    const unsubError = client.on<ErrorPayload>("error", (payload) => {
      setError(payload.message);
      options.onError?.(payload);
    });

    // Cleanup
    return () => {
      unsubNewMessage();
      unsubMessageStatus();
      unsubMessageReaction();
      unsubTypingStart();
      unsubTypingStop();
      unsubPresenceOnline();
      unsubPresenceOffline();
      unsubConversationUpdated();
      unsubError();
    };
  }, [
    getClient,
    addMessage,
    updateMessageStatus,
    updateMessageReaction,
    handleTypingStart,
    handleTypingStop,
    setError,
    options,
  ]);
}
