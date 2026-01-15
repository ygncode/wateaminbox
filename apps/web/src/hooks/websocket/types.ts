import type {
  ConversationUpdatedPayload,
  ErrorPayload,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  TypingPayload,
  WebSocketClient,
} from "../../lib/websocket";
import type {
  MessageFailedPayload,
  ToastNotificationPayload,
  WorkerConnectionStatusPayload,
} from "@whatsapp-web/shared";

// WhatsApp typing payload (different from internal TypingPayload)
export interface WhatsAppTypingPayload {
  jid: string;
  chatJid: string;
  mediaType?: string;
}

// Typing timeout in milliseconds (stop typing after 5 seconds of no updates)
export const TYPING_TIMEOUT = 5000;

export interface UseWebSocketOptions {
  autoConnect?: boolean;
  onNewMessage?: (payload: NewMessagePayload) => void;
  onMessageStatus?: (payload: MessageStatusPayload) => void;
  onTypingStart?: (payload: TypingPayload) => void;
  onTypingStop?: (payload: TypingPayload) => void;
  onPresenceChange?: (payload: PresencePayload) => void;
  onConversationUpdated?: (payload: ConversationUpdatedPayload) => void;
  onError?: (payload: ErrorPayload) => void;
}

export type { WebSocketClient };

// Re-export payload types for convenience
export type {
  ConversationUpdatedPayload,
  ErrorPayload,
  MessageStatusPayload,
  MessageFailedPayload,
  NewMessagePayload,
  PresencePayload,
  ToastNotificationPayload,
  TypingPayload,
  WorkerConnectionStatusPayload,
};
