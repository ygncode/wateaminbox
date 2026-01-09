import { useCallback, useRef } from "react";
import { type TypingIndicator, useChatStore } from "../../stores/chat-store";
import {
  TYPING_TIMEOUT,
  type TypingPayload,
  type WhatsAppTypingPayload,
} from "./types";

/**
 * Hook for managing typing indicator state and timeouts.
 * Handles both internal typing events (from team members) and WhatsApp typing events (from contacts).
 */
export function useTypingIndicators() {
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const addTypingIndicator = useChatStore((state) => state.addTypingIndicator);
  const removeTypingIndicator = useChatStore(
    (state) => state.removeTypingIndicator,
  );

  // Set a timeout to automatically clear typing indicator
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
        removeTypingIndicator(conversationId, userId);
        typingTimeoutsRef.current.delete(key);
      }, TYPING_TIMEOUT);

      typingTimeoutsRef.current.set(key, timeout);
    },
    [removeTypingIndicator],
  );

  // Clear a typing timeout
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

  // Handle typing start event
  const handleTypingStart = useCallback(
    (
      payload: TypingPayload | WhatsAppTypingPayload,
      onTypingStart?: (payload: TypingPayload) => void,
    ) => {
      // Handle WhatsApp typing events (from contacts)
      if ("jid" in payload) {
        // For WhatsApp typing events, use jid as both conversationId and userId
        // The frontend will match this to the correct contact via jid
        const indicator: TypingIndicator = {
          conversationId: payload.jid, // Use jid as conversation identifier
          userId: payload.jid,
          userName: "", // Contact name will be displayed from context
          startedAt: new Date(),
        };
        addTypingIndicator(indicator);
        setTypingTimeout(payload.jid, payload.jid);
        onTypingStart?.({
          conversationId: payload.jid,
          userId: payload.jid,
          userName: "",
        });
      } else {
        // Handle internal typing events (from team members)
        const indicator: TypingIndicator = {
          conversationId: payload.conversationId,
          userId: payload.userId,
          userName: payload.userName,
          startedAt: new Date(),
        };
        addTypingIndicator(indicator);
        setTypingTimeout(payload.conversationId, payload.userId);
        onTypingStart?.(payload);
      }
    },
    [addTypingIndicator, setTypingTimeout],
  );

  // Handle typing stop event
  const handleTypingStop = useCallback(
    (
      payload: TypingPayload | WhatsAppTypingPayload,
      onTypingStop?: (payload: TypingPayload) => void,
    ) => {
      if ("jid" in payload) {
        // Handle WhatsApp typing events
        removeTypingIndicator(payload.jid, payload.jid);
        clearTypingTimeout(payload.jid, payload.jid);
        onTypingStop?.({
          conversationId: payload.jid,
          userId: payload.jid,
          userName: "",
        });
      } else {
        // Handle internal typing events
        removeTypingIndicator(payload.conversationId, payload.userId);
        clearTypingTimeout(payload.conversationId, payload.userId);
        onTypingStop?.(payload);
      }
    },
    [removeTypingIndicator, clearTypingTimeout],
  );

  // Cleanup all typing timeouts
  const cleanup = useCallback(() => {
    typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    typingTimeoutsRef.current.clear();
  }, []);

  return {
    handleTypingStart,
    handleTypingStop,
    setTypingTimeout,
    clearTypingTimeout,
    cleanup,
  };
}
