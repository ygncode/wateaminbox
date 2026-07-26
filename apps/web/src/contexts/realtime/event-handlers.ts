import type { QueryClient } from "@tanstack/react-query";
import type {
  ConversationReadPayload,
  MediaDownloadedPayload,
  MediaDownloadFailedPayload,
  MessageDeletedPayload,
  MessageFailedPayload,
  MessageReactionPayload,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  ProfilePicturePayload,
  SyncStatusPayload,
  TypingPayload,
} from "@wateaminbox/shared";
import { advanceMessageStatus } from "@wateaminbox/shared";
import type { Dispatch, SetStateAction } from "react";
import { queryKeys } from "../../hooks/query-keys";
import { markConversationAsRead } from "../../lib/api/conversations";
import { bindEvent } from "../../lib/realtime";
import { showRealtimeToast } from "../../lib/toast-notifications";
import type { TypingIndicator } from "../../stores/chat-store";
import { useChatStore } from "../../stores/chat-store";
import {
  addMessageToCache,
  invalidateChatList,
  refetchConversationMessages,
  updateContactDetailsByJid,
  updateContactInChatList,
  updateMessageInCache,
} from "./cache-utils";
import {
  endSync,
  type SyncState,
  startSync,
  updateSyncProgress,
} from "./sync-state";

export type { SyncState } from "./sync-state";

interface RealtimeEventHandlerOptions {
  queryClient: QueryClient;
  companyId: string;
  setSyncingConnections: Dispatch<SetStateAction<Map<string, SyncState>>>;
  addTypingIndicator: (indicator: TypingIndicator) => void;
  removeTypingIndicator: (conversationId: string, userId: string) => void;
  setTypingTimeout: (conversationId: string, userId: string) => void;
  clearTypingTimeout: (conversationId: string, userId: string) => void;
}

/** Register typed, company-scoped handlers and return their cleanup functions. */
export function registerRealtimeEventHandlers({
  queryClient: qc,
  companyId,
  setSyncingConnections,
  addTypingIndicator,
  removeTypingIndicator,
  setTypingTimeout,
  clearTypingTimeout,
}: RealtimeEventHandlerOptions): (() => void)[] {
  return [
    bindEvent("notification:toast", (data) => {
      const payload =
        data.payload && typeof data.payload === "object"
          ? { connectionId: data.connectionId, ...data.payload }
          : data.payload;
      showRealtimeToast(payload);
    }),
    bindEvent<NewMessagePayload>("message:new", (data) => {
      const payload = data.payload;
      addMessageToCache(qc, payload.conversationId, payload.message);
      invalidateChatList(qc);

      // Treat realtime as an update signal, not the source of truth. In
      // particular, WhatsApp can replay several offline messages immediately
      // after reconnecting while the active infinite-query cache is being
      // remounted. The optimistic cache write above is instant when that cache
      // exists; this active-only refetch guarantees the open thread reconciles
      // with the committed PostgreSQL rows without requiring another click.
      refetchConversationMessages(qc, payload.conversationId);

      const selectedId = useChatStore.getState().selectedConversationId;
      if (
        selectedId === payload.conversationId &&
        payload.message.senderType === "contact"
      ) {
        markConversationAsRead(payload.conversationId).catch(() => {});
      }
    }),
    bindEvent<MessageStatusPayload>("message:status", (data) => {
      const payload = data.payload;
      updateMessageInCache(
        qc,
        payload.conversationId,
        payload.messageId,
        (message) => ({
          ...message,
          status: advanceMessageStatus(message.status, payload.status),
        }),
      );
    }),
    bindEvent<MessageFailedPayload>("message:failed", (data) => {
      const payload = data.payload;
      updateMessageInCache(
        qc,
        payload.conversationId,
        payload.messageId,
        (message) => ({
          ...message,
          status: advanceMessageStatus(message.status, "failed"),
        }),
      );
    }),
    bindEvent<MessageReactionPayload>("message:reaction", (data) => {
      const payload = data.payload;
      updateMessageInCache(
        qc,
        payload.contactId,
        payload.messageId,
        (message) => {
          const reactions = message.reactions || [];
          if (!payload.emoji) {
            return {
              ...message,
              reactions: reactions.filter(
                (reaction) => reaction.reactorJid !== payload.from,
              ),
            };
          }
          const existingIndex = reactions.findIndex(
            (reaction) => reaction.reactorJid === payload.from,
          );
          if (existingIndex >= 0) {
            const updated = [...reactions];
            updated[existingIndex] = {
              ...updated[existingIndex],
              emoji: payload.emoji,
              reactorName:
                payload.reactorName ?? updated[existingIndex].reactorName,
              reactorAvatarUrl:
                payload.reactorAvatarUrl ??
                updated[existingIndex].reactorAvatarUrl,
              isOwn: payload.isOwn ?? updated[existingIndex].isOwn,
              createdAt: new Date(),
            };
            return { ...message, reactions: updated };
          }
          return {
            ...message,
            reactions: [
              ...reactions,
              {
                emoji: payload.emoji,
                reactorJid: payload.from,
                reactorName: payload.reactorName,
                reactorAvatarUrl: payload.reactorAvatarUrl,
                isOwn: payload.isOwn,
                createdAt: new Date(),
              },
            ],
          };
        },
      );
    }),
    bindEvent<TypingPayload>("typing:start", (data) => {
      const payload = data.payload;
      addTypingIndicator({
        conversationId: payload.conversationId,
        userId: payload.userId,
        userName: payload.userName,
        startedAt: new Date(),
      });
      setTypingTimeout(payload.conversationId, payload.userId);
    }),
    bindEvent<TypingPayload>("typing:stop", (data) => {
      const payload = data.payload;
      removeTypingIndicator(payload.conversationId, payload.userId);
      clearTypingTimeout(payload.conversationId, payload.userId);
    }),
    bindEvent<ConversationReadPayload>("conversation:read", () => {
      invalidateChatList(qc);
    }),
    bindEvent("conversation:updated", () => invalidateChatList(qc)),
    bindEvent("contact:updated", () => invalidateChatList(qc)),
    bindEvent("labels:updated", () => {
      qc.invalidateQueries({ queryKey: ["labels", companyId] });
    }),
    bindEvent("catalogs:updated", () => {
      qc.invalidateQueries({ queryKey: ["catalogs", companyId] });
    }),
    bindEvent("command:failed", () => {
      invalidateChatList(qc);
      const selectedId = useChatStore.getState().selectedConversationId;
      if (selectedId) refetchConversationMessages(qc, selectedId);
      qc.invalidateQueries({ queryKey: ["labels", companyId] });
      qc.invalidateQueries({ queryKey: ["catalogs", companyId] });
      qc.invalidateQueries({ queryKey: queryKeys.groups.all });
    }),
    bindEvent<ProfilePicturePayload>("contact:profile_picture", (data) => {
      const payload = data.payload;
      updateContactInChatList(qc, payload.jid, (contact) => ({
        ...contact,
        avatarUrl: payload.profilePictureUrl,
      }));
    }),
    bindEvent<MessageDeletedPayload>("message:deleted", (data) => {
      const payload = data.payload;
      updateMessageInCache(
        qc,
        payload.conversationId,
        payload.messageId,
        (message) => ({
          ...message,
          deleted_by_sender: true,
          deleted_at: new Date().toISOString(),
        }),
      );
    }),
    bindEvent<PresencePayload>("presence:online", (data) => {
      const { jid } = data.payload;
      updateContactInChatList(qc, jid, (contact) => ({
        ...contact,
        isOnline: true,
        lastSeen: undefined,
      }));
      updateContactDetailsByJid(qc, jid, (contact) => ({
        ...contact,
        isOnline: true,
        lastSeen: null,
      }));
    }),
    bindEvent<PresencePayload>("presence:offline", (data) => {
      const payload = data.payload;
      updateContactInChatList(qc, payload.jid, (contact) => ({
        ...contact,
        isOnline: false,
        lastSeen: payload.lastSeen ? new Date(payload.lastSeen) : undefined,
      }));
      updateContactDetailsByJid(qc, payload.jid, (contact) => ({
        ...contact,
        isOnline: false,
        lastSeen: payload.lastSeen ?? null,
      }));
    }),
    bindEvent<MediaDownloadedPayload>("media:downloaded", (data) => {
      const payload = data.payload;
      updateMessageInCache(
        qc,
        payload.conversationId,
        payload.messageId,
        (message) => ({
          ...message,
          metadata: {
            ...(message.metadata || {}),
            mediaUrl: payload.mediaUrl,
            mediaPending: false,
            mediaDownloadStatus: "completed" as const,
            fileSize: payload.mediaSize || message.metadata?.fileSize,
          },
        }),
      );
      refetchConversationMessages(qc, payload.conversationId);
    }),
    bindEvent<MediaDownloadFailedPayload>("media:download_failed", (data) => {
      const payload = data.payload;
      updateMessageInCache(
        qc,
        payload.conversationId,
        payload.messageId,
        (message) => ({
          ...message,
          metadata: {
            ...(message.metadata || {}),
            mediaPending: true,
            mediaDownloadStatus: "failed" as const,
          },
        }),
      );
      refetchConversationMessages(qc, payload.conversationId);
    }),
    bindEvent<SyncStatusPayload>("sync:start", (data) => {
      const connectionId = data.connectionId || "unknown";
      setSyncingConnections((previous) => startSync(previous, connectionId));
    }),
    bindEvent<SyncStatusPayload>("sync:progress", (data) => {
      const connectionId = data.connectionId || "unknown";
      setSyncingConnections((previous) =>
        updateSyncProgress(
          previous,
          connectionId,
          data.payload.conversations,
          data.payload.messageCount,
        ),
      );
    }),
    bindEvent<SyncStatusPayload>("sync:complete", (data) => {
      const connectionId = data.connectionId || "unknown";
      setSyncingConnections((previous) => endSync(previous, connectionId));
      invalidateChatList(qc);
      const selectedId = useChatStore.getState().selectedConversationId;
      if (selectedId) refetchConversationMessages(qc, selectedId);
    }),
    bindEvent<SyncStatusPayload>("sync:interrupted", (data) => {
      const connectionId = data.connectionId || "unknown";
      setSyncingConnections((previous) => endSync(previous, connectionId));
    }),
  ];
}

/** Reconcile server state after reconnecting so missed events cannot stale UI. */
export function reconcileRealtimeState(
  queryClient: QueryClient,
  selectedConversationId: string | null,
): void {
  invalidateChatList(queryClient);
  queryClient.invalidateQueries({ queryKey: queryKeys.contacts.details() });
  if (selectedConversationId) {
    refetchConversationMessages(queryClient, selectedConversationId);
  }
}
