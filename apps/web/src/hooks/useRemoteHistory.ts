import {
  type InfiniteData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  HistoryLoadedPayload,
  PaginatedMessages,
  RemoteHistoryStatus,
} from "@wateaminbox/shared";
import { REMOTE_HISTORY_RESPONSE_TIMEOUT_MS } from "@wateaminbox/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeContext } from "../contexts";
import { api } from "../lib/api";
import { fetchMessagesPage, infiniteMessageKeys } from "./useInfiniteMessages";

export function oldestLoadedMessageId(
  data: InfiniteData<PaginatedMessages, string | undefined> | undefined,
): string | undefined {
  const oldestPage = data?.pages[data.pages.length - 1];
  return oldestPage?.messages[oldestPage.messages.length - 1]?.id;
}

export function withRemoteStatus(
  data: InfiniteData<PaginatedMessages, string | undefined> | undefined,
  status: RemoteHistoryStatus,
) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      remoteHistoryStatus: status,
    })),
  };
}

export function appendRemoteHistoryPage(
  current: InfiniteData<PaginatedMessages, string | undefined> | undefined,
  page: PaginatedMessages,
  cursor: string,
  status: RemoteHistoryStatus,
) {
  if (!current) return current;
  const existingIds = new Set(
    current.pages.flatMap((item) => item.messages.map((message) => message.id)),
  );
  const newMessages = page.messages.filter(
    (message) => !existingIds.has(message.id),
  );
  const updated = withRemoteStatus(current, status);
  if (!updated || newMessages.length === 0) return updated;
  return {
    ...updated,
    pages: [
      ...updated.pages,
      {
        ...page,
        messages: newMessages,
        hasMore: status === "available" ? page.hasMore : false,
        remoteHistoryStatus: status,
      },
    ],
    pageParams: [...updated.pageParams, cursor],
  };
}

export function useRemoteHistory(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const { subscribe } = useRealtimeContext();
  const [error, setError] = useState<string | null>(null);
  const pendingAnchorRef = useRef<string | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResponseTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const setCachedStatus = useCallback(
    (status: RemoteHistoryStatus) => {
      if (!conversationId) return;
      queryClient.setQueryData<
        InfiniteData<PaginatedMessages, string | undefined>
      >(infiniteMessageKeys.list(conversationId), (data) =>
        withRemoteStatus(data, status),
      );
    },
    [conversationId, queryClient],
  );

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error("No conversation selected");
      const cached = queryClient.getQueryData<
        InfiniteData<PaginatedMessages, string | undefined>
      >(infiniteMessageKeys.list(conversationId));
      pendingAnchorRef.current = oldestLoadedMessageId(cached);
      if (!pendingAnchorRef.current) {
        throw new Error("No local message is available as a history anchor");
      }
      return api.post<{
        queued: boolean;
        alreadyPending: boolean;
        remoteHistoryStatus: "requesting";
      }>(`/conversations/${conversationId}/history`, {});
    },
    onMutate: () => {
      setError(null);
      setCachedStatus("requesting");
      clearResponseTimeout();
    },
    onSuccess: () => {
      timeoutRef.current = setTimeout(() => {
        setError(
          "WhatsApp has not returned this history page yet. Your phone may still be online; try again in a moment.",
        );
        setCachedStatus("failed");
      }, REMOTE_HISTORY_RESPONSE_TIMEOUT_MS);
    },
    onError: (requestError: Error) => {
      setError(requestError.message);
      setCachedStatus("failed");
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    return subscribe<HistoryLoadedPayload>(
      "history:loaded",
      async (payload) => {
        if (payload.conversationId !== conversationId) return;
        clearResponseTimeout();

        if (payload.status === "failed") {
          setError(payload.error || "Unable to load older messages");
          setCachedStatus("failed");
          return;
        }

        try {
          const cached = queryClient.getQueryData<
            InfiniteData<PaginatedMessages, string | undefined>
          >(infiniteMessageKeys.list(conversationId));
          const cursor =
            pendingAnchorRef.current ?? oldestLoadedMessageId(cached);
          if (!cursor) return;

          const page = await fetchMessagesPage({
            conversationId,
            cursor,
            limit: 50,
          });
          queryClient.setQueryData<
            InfiniteData<PaginatedMessages, string | undefined>
          >(infiniteMessageKeys.list(conversationId), (current) =>
            appendRemoteHistoryPage(current, page, cursor, payload.status),
          );
          pendingAnchorRef.current = undefined;
          setError(null);
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Older messages were imported but could not be displayed",
          );
          setCachedStatus("failed");
        }
      },
    );
  }, [
    clearResponseTimeout,
    conversationId,
    queryClient,
    setCachedStatus,
    subscribe,
  ]);

  useEffect(() => {
    pendingAnchorRef.current = undefined;
    setError(null);
    clearResponseTimeout();
    return clearResponseTimeout;
  }, [clearResponseTimeout, conversationId]);

  return {
    requestHistory: requestMutation.mutate,
    isRequesting: requestMutation.isPending,
    error,
  };
}
