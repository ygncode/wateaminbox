import type { Message } from "@whatsapp-web/shared";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";

/**
 * Message action handlers that can be triggered from MessageBubble
 * This context eliminates prop drilling through MessageThread → VirtualMessageList → MessageBubble
 *
 * Note: onRetry is NOT included here because it's local to MessageThread and uses local state
 */
export interface MessageActionsContextValue {
  /** Reply to a message */
  onReply?: (message: Message) => void;
  /** Forward a message to another contact */
  onForward?: (message: Message) => void;
  /** Delete a message */
  onDelete?: (message: Message) => void;
  /** Star/unstar a message */
  onStar?: (message: Message) => void;
  /** React to a message with an emoji */
  onReact?: (message: Message, emoji: string) => void;
}

const MessageActionsContext = createContext<MessageActionsContextValue | undefined>(undefined);

export interface MessageActionsProviderProps {
  children: ReactNode;
  /** Reply to a message */
  onReply?: (message: Message) => void;
  /** Forward a message to another contact */
  onForward?: (message: Message) => void;
  /** Delete a message */
  onDelete?: (message: Message) => void;
  /** Star/unstar a message */
  onStar?: (message: Message) => void;
  /** React to a message with an emoji */
  onReact?: (message: Message, emoji: string) => void;
}

export function MessageActionsProvider({
  children,
  onReply,
  onForward,
  onDelete,
  onStar,
  onReact,
}: MessageActionsProviderProps) {
  const value = useMemo<MessageActionsContextValue>(
    () => ({
      onReply,
      onForward,
      onDelete,
      onStar,
      onReact,
    }),
    [onReply, onForward, onDelete, onStar, onReact],
  );

  return (
    <MessageActionsContext.Provider value={value}>
      {children}
    </MessageActionsContext.Provider>
  );
}

/**
 * Hook to access message action handlers
 * Returns undefined values if used outside MessageActionsProvider (safe fallback)
 */
export function useMessageActions(): MessageActionsContextValue {
  const context = useContext(MessageActionsContext);
  // Return empty object if context is not provided - allows component to work
  // both with and without the provider (graceful degradation)
  return context ?? {};
}

/**
 * Hook that throws if used outside provider (strict mode)
 * Use this when the context is required
 */
export function useMessageActionsStrict(): MessageActionsContextValue {
  const context = useContext(MessageActionsContext);
  if (context === undefined) {
    throw new Error("useMessageActionsStrict must be used within a MessageActionsProvider");
  }
  return context;
}
