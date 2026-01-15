import { useEffect } from "react";
import { toast } from "sonner";
import { useChatStore } from "../../stores/chat-store";
import type {
  ConversationUpdatedPayload,
  ErrorPayload,
  MessageFailedPayload,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  ToastNotificationPayload,
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

    // Message failed handler - when message fails after max retries
    const unsubMessageFailed = client.on<MessageFailedPayload>(
      "message:failed",
      (payload) => {
        updateMessageStatus(
          payload.conversationId,
          payload.messageId,
          "failed",
        );
      },
    );

    // Toast notification handler - server-sent toast messages
    const unsubToast = client.on<ToastNotificationPayload>(
      "notification:toast",
      (payload) => {
        switch (payload.type) {
          case "error":
            toast.error(payload.message, { description: payload.title });
            break;
          case "success":
            toast.success(payload.message, { description: payload.title });
            break;
          case "warning":
            toast.warning(payload.message, { description: payload.title });
            break;
          case "info":
          default:
            toast.info(payload.message, { description: payload.title });
            break;
        }
      },
    );

    // Note: message:reaction is handled in event-handlers.ts which updates
    // the TanStack Query cache directly for proper real-time updates

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
      unsubMessageFailed();
      unsubToast();
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
    handleTypingStart,
    handleTypingStop,
    setError,
    options,
  ]);
}
