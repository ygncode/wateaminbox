import type { Message, MessageStatus } from "@whatsapp-web/shared";
import type { StateCreator } from "zustand";
import type { ChatState, MessagesSlice, OptimisticMessage } from "./types";

export const createMessagesSlice: StateCreator<
  ChatState,
  [["zustand/devtools", never], ["zustand/persist", unknown]],
  [],
  MessagesSlice
> = (set) => ({
  messagesCache: new Map<string, Message[]>(),
  optimisticMessages: new Map<string, OptimisticMessage>(),

  setMessages: (conversationId, messages) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        newMap.set(conversationId, messages);
        return { messagesCache: newMap };
      },
      false,
      "setMessages",
    ),

  addMessage: (conversationId, message) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        const existing = newMap.get(conversationId) ?? [];

        // Don't add duplicate messages
        if (existing.some((m) => m.id === message.id)) {
          return state;
        }

        newMap.set(conversationId, [...existing, message]);
        return { messagesCache: newMap };
      },
      false,
      "addMessage",
    ),

  updateMessage: (conversationId, messageId, updates) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        const existing = newMap.get(conversationId);

        if (!existing) return state;

        const updatedMessages = existing.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg,
        );

        newMap.set(conversationId, updatedMessages);
        return { messagesCache: newMap };
      },
      false,
      "updateMessage",
    ),

  updateMessageStatus: (conversationId, messageId, status) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        const existing = newMap.get(conversationId);

        if (!existing) return state;

        const updatedMessages = existing.map((msg) =>
          msg.id === messageId ? { ...msg, status } : msg,
        );

        newMap.set(conversationId, updatedMessages);
        return { messagesCache: newMap };
      },
      false,
      "updateMessageStatus",
    ),

  updateMessageReaction: (conversationId, messageId, reactorJid, emoji) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        const existing = newMap.get(conversationId);

        if (!existing) return state;

        const updatedMessages = existing.map((msg) => {
          if (msg.id !== messageId) return msg;

          const currentReactions = msg.reactions || [];

          // If emoji is empty, remove the reaction
          if (!emoji) {
            return {
              ...msg,
              reactions: currentReactions.filter(
                (r) => r.reactorJid !== reactorJid,
              ),
            };
          }

          // Check if this reactor already has a reaction
          const existingReactionIndex = currentReactions.findIndex(
            (r) => r.reactorJid === reactorJid,
          );

          if (existingReactionIndex >= 0) {
            // Update existing reaction
            const updatedReactions = [...currentReactions];
            updatedReactions[existingReactionIndex] = {
              ...updatedReactions[existingReactionIndex],
              emoji,
              createdAt: new Date(),
            };
            return { ...msg, reactions: updatedReactions };
          }

          // Add new reaction
          return {
            ...msg,
            reactions: [
              ...currentReactions,
              { emoji, reactorJid, createdAt: new Date() },
            ],
          };
        });

        newMap.set(conversationId, updatedMessages);
        return { messagesCache: newMap };
      },
      false,
      "updateMessageReaction",
    ),

  removeMessage: (conversationId, messageId) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        const existing = newMap.get(conversationId);

        if (!existing) return state;

        const filtered = existing.filter((msg) => msg.id !== messageId);
        newMap.set(conversationId, filtered);
        return { messagesCache: newMap };
      },
      false,
      "removeMessage",
    ),

  prependMessages: (conversationId, messages) =>
    set(
      (state) => {
        const newMap = new Map(state.messagesCache);
        const existing = newMap.get(conversationId) ?? [];

        // Filter out duplicates
        const existingIds = new Set(existing.map((m) => m.id));
        const newMessages = messages.filter((m) => !existingIds.has(m.id));

        newMap.set(conversationId, [...newMessages, ...existing]);
        return { messagesCache: newMap };
      },
      false,
      "prependMessages",
    ),

  addOptimisticMessage: (message) =>
    set(
      (state) => {
        const newOptimistic = new Map(state.optimisticMessages);
        newOptimistic.set(message.tempId, message);

        const newMessages = new Map(state.messagesCache);
        const existing = newMessages.get(message.conversationId) ?? [];
        newMessages.set(message.conversationId, [
          ...existing,
          message as Message,
        ]);

        return {
          optimisticMessages: newOptimistic,
          messagesCache: newMessages,
        };
      },
      false,
      "addOptimisticMessage",
    ),

  confirmOptimisticMessage: (tempId, confirmedMessage) =>
    set(
      (state) => {
        const optimistic = state.optimisticMessages.get(tempId);
        if (!optimistic) return state;

        const newOptimistic = new Map(state.optimisticMessages);
        newOptimistic.delete(tempId);

        const newMessages = new Map(state.messagesCache);
        const existing = newMessages.get(confirmedMessage.conversationId) ?? [];

        // Replace optimistic message with confirmed one
        const updatedMessages = existing.map((msg) =>
          (msg as OptimisticMessage).tempId === tempId ? confirmedMessage : msg,
        );

        newMessages.set(confirmedMessage.conversationId, updatedMessages);

        return {
          optimisticMessages: newOptimistic,
          messagesCache: newMessages,
        };
      },
      false,
      "confirmOptimisticMessage",
    ),

  failOptimisticMessage: (tempId) =>
    set(
      (state) => {
        const optimistic = state.optimisticMessages.get(tempId);
        if (!optimistic) return state;

        const newOptimistic = new Map(state.optimisticMessages);
        newOptimistic.delete(tempId);

        const newMessages = new Map(state.messagesCache);
        const existing = newMessages.get(optimistic.conversationId) ?? [];

        // Mark the message as failed instead of removing
        const updatedMessages = existing.map((msg) =>
          (msg as OptimisticMessage).tempId === tempId
            ? { ...msg, status: "failed" as MessageStatus }
            : msg,
        );

        newMessages.set(optimistic.conversationId, updatedMessages);

        return {
          optimisticMessages: newOptimistic,
          messagesCache: newMessages,
        };
      },
      false,
      "failOptimisticMessage",
    ),
});
