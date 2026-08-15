import type { Message } from "@wateaminbox/shared";
import { MessageCircle, SearchX, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGroup } from "@/hooks/useGroups";
import {
  type TeamMemberIdentity,
  useTeamMemberIdentities,
} from "@/hooks/useTeam";
import { useTheme, useWorkspace } from "../../contexts";
import { useMessageSelection } from "../../hooks/chat/useMessageSelection";
import { useMessageVirtualization } from "../../hooks/chat/useMessageVirtualization";
import { useInfiniteMessages } from "../../hooks/useInfiniteMessages";
import { useRetryMessage } from "../../hooks/useMessages";
import { useRemoteHistory } from "../../hooks/useRemoteHistory";
import { ChatContextMenu } from "./ChatContextMenu";
import { MessageSelectionToolbar } from "./MessageSelectionToolbar";
import {
  type MessageNavigationTarget,
  resolveMessageNavigationTarget,
} from "./message-navigation";
import { VirtualMessageList } from "./VirtualMessageList";

const EMPTY_MESSAGES: Message[] = [];

export function shouldDismissReplyHighlight(
  clickedMessageId: string | null,
  replyTargetMessageId: string | null,
): boolean {
  return Boolean(
    replyTargetMessageId && clickedMessageId !== replyTargetMessageId,
  );
}

interface MessageThreadProps {
  conversationId: string | undefined;
  currentUserId: string;
  currentUserName?: string;
  currentUserAvatarUrl?: string;
  currentUserGravatarUrl?: string;
  isGroup?: boolean;
  /** ID of message to highlight and scroll to */
  highlightedMessageId?: string | null;
  /** Callback when user clicks "Contact info" in context menu */
  onOpenContactInfo?: () => void;
  /**
   * Whether the current user can currently send in this conversation (same
   * gate the composer itself uses - see useComposerAccess). When false, the
   * Retry button is hidden: retrying a failed message is itself a send, and
   * offering it to an assigned-other/resolved/no-permission user would only
   * 403/409 server-side while looking actionable.
   */
  canRetry?: boolean;
}

export function MessageThread({
  conversationId,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  currentUserGravatarUrl,
  isGroup = false,
  highlightedMessageId,
  onOpenContactInfo,
  canRetry = true,
}: MessageThreadProps) {
  const retryMessage = useRetryMessage();
  const { resolvedTheme } = useTheme();
  const { activeWorkspaceId } = useWorkspace();
  const { data: teammateIdentities = [] } =
    useTeamMemberIdentities(activeWorkspaceId);
  const teammateIdentityMap = useMemo(
    () =>
      new Map<string, TeamMemberIdentity>(
        teammateIdentities.map((identity) => [identity.userId, identity]),
      ),
    [teammateIdentities],
  );
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [replyNavigation, setReplyNavigation] = useState<{
    target: MessageNavigationTarget;
    requestKey: number;
  } | null>(null);
  const { data: group } = useGroup(
    isGroup && conversationId ? conversationId : null,
  );
  useEffect(() => {
    setReplyNavigation(null);
  }, [conversationId]);

  const handleNavigateToMessage = useCallback(
    (target: MessageNavigationTarget) => {
      setReplyNavigation((current) => ({
        target,
        requestKey: (current?.requestKey ?? 0) + 1,
      }));
    },
    [],
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Fetch messages
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteMessages(conversationId);
  const {
    requestHistory: requestRemoteHistory,
    isRequesting: isRequestingRemoteHistory,
    error: remoteHistoryError,
  } = useRemoteHistory(conversationId);

  const messages = data?.messages ?? EMPTY_MESSAGES;
  const remoteHistoryStatus = data?.remoteHistoryStatus ?? "unknown";
  const resolvedReplyMessage = resolveMessageNavigationTarget(
    messages,
    replyNavigation?.target ?? null,
  );
  const activeHighlightedMessageId =
    highlightedMessageId ??
    resolvedReplyMessage?.id ??
    (replyNavigation?.target.kind === "database"
      ? replyNavigation.target.messageId
      : null);
  const activeNavigationTarget = highlightedMessageId
    ? null
    : replyNavigation?.target;

  useEffect(() => {
    const replyTargetMessageId = replyNavigation
      ? (activeHighlightedMessageId ?? replyNavigation.target.messageId)
      : null;
    if (!replyTargetMessageId) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const clickedElement =
        event.target instanceof Element ? event.target : null;
      const clickedMessageId =
        clickedElement
          ?.closest<HTMLElement>("[data-message-id]")
          ?.getAttribute("data-message-id") ?? null;

      if (shouldDismissReplyHighlight(clickedMessageId, replyTargetMessageId)) {
        setReplyNavigation(null);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [activeHighlightedMessageId, replyNavigation]);

  // Use selection hook
  const {
    selectionMode,
    selectedMessageIds,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    handleMessageClick,
  } = useMessageSelection(conversationId);

  // Use virtualization hook
  const {
    virtualizer,
    scrollContainerRef,
    items,
    virtualRows,
    totalSize,
    handleScroll: handleVirtualScroll,
    scrollToBottom,
    isAtBottom,
    isLoadingHighlightedMessage,
    isHighlightedMessageUnavailable,
  } = useMessageVirtualization({
    messages,
    conversationId,
    highlightedMessageId: activeHighlightedMessageId,
    navigationTarget: activeNavigationTarget,
    highlightRequestKey: replyNavigation?.requestKey,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    remoteHistoryStatus,
    isRequestingRemoteHistory,
    requestRemoteHistory,
  });

  // Enhanced scroll handler that includes infinite loading logic
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (
      container &&
      container.scrollTop < 200 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
    handleVirtualScroll();
  }, [
    scrollContainerRef,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    handleVirtualScroll,
  ]);

  // Handle retry message
  const handleRetry = useCallback(
    (messageId: string) => {
      setRetryingMessageId(messageId);
      retryMessage.mutate(messageId, {
        onSettled: () => {
          setRetryingMessageId(null);
        },
      });
    },
    [retryMessage],
  );

  // Handle background context menu (right-click on empty area)
  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    // Only show context menu if clicking on the background, not on a message
    const target = e.target as HTMLElement;
    if (target.closest("[data-message-id]")) {
      return; // Let the message bubble handle its own context menu
    }

    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Empty state when no chat selected
  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-dark-primary">
        <div className="text-center max-w-md px-4">
          <div className="mb-4">
            <svg
              className="mx-auto h-24 w-24 text-gray-300 dark:text-dark-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-600 dark:text-dark-text-secondary mb-2">
            WATeamInbox
          </h2>
          <p className="text-gray-500 dark:text-dark-text-tertiary">
            Select a conversation to start messaging
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-dark-primary">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="animate-spin h-8 w-8 text-whatsapp-green"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            Loading messages...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-dark-primary">
        <div className="text-center max-w-md px-4">
          <div className="mb-4">
            <svg
              className="mx-auto h-16 w-16 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text-primary mb-1">
            Failed to load messages
          </h3>
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            {error instanceof Error ? error.message : "An error occurred"}
          </p>
        </div>
      </div>
    );
  }

  // Keep empty and populated conversations on the same message surface.
  const patternColor = resolvedTheme === "dark" ? "%231a2730" : "%23000000";
  const patternOpacity = resolvedTheme === "dark" ? "0.4" : "1";

  // Empty messages state
  if (messages.length === 0) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#e5ddd5] dark:bg-dark-primary">
        <div
          className="absolute inset-0 opacity-5 dark:opacity-100"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='${patternColor}' fill-opacity='${patternOpacity}'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
          aria-hidden="true"
        />

        <div className="relative flex max-w-sm flex-col items-center px-6 text-center">
          <div className="relative mb-5">
            <div className="grid size-20 place-items-center rounded-2xl border border-white/80 bg-white/70 shadow-sm backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.055]">
              <MessageCircle
                className="size-9 text-[#66756f] dark:text-dark-text-secondary"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            </div>
            <span className="absolute -bottom-1.5 -right-1.5 grid size-8 place-items-center rounded-full border-2 border-[#e5ddd5] bg-whatsapp-dark-green text-white shadow-sm dark:border-dark-primary">
              <Send className="size-3.5" aria-hidden="true" />
            </span>
          </div>

          <h2 className="text-base font-semibold tracking-tight text-[#263a33] dark:text-dark-text-primary">
            No messages yet
          </h2>
          <p className="mt-1.5 max-w-[280px] text-sm leading-6 text-[#66756f] dark:text-dark-text-secondary">
            Send the first message below to start this conversation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative flex flex-col min-h-0 bg-[#e5ddd5] dark:bg-dark-primary">
      {/* Selection mode header */}
      <MessageSelectionToolbar
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        onExit={exitSelectionMode}
      />

      {/* WhatsApp-style background pattern */}
      <div
        className="absolute inset-0 opacity-5 dark:opacity-100"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='${patternColor}' fill-opacity='${patternOpacity}'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Virtualized message list */}
      <VirtualMessageList
        virtualRows={virtualRows}
        measureElement={virtualizer.measureElement}
        items={items}
        totalSize={totalSize}
        isGroup={isGroup}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        currentUserAvatarUrl={currentUserAvatarUrl}
        currentUserGravatarUrl={currentUserGravatarUrl}
        teammateIdentities={teammateIdentityMap}
        highlightedMessageId={activeHighlightedMessageId}
        retryingMessageId={retryingMessageId}
        selectionMode={selectionMode}
        selectedMessageIds={selectedMessageIds}
        onMessageClick={handleMessageClick}
        onRetryMessage={canRetry ? handleRetry : undefined}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        remoteHistoryStatus={remoteHistoryStatus}
        isRequestingRemoteHistory={isRequestingRemoteHistory}
        remoteHistoryError={remoteHistoryError}
        onRequestRemoteHistory={requestRemoteHistory}
        onScroll={handleScroll}
        scrollContainerRef={scrollContainerRef}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        mentionParticipants={group?.participants}
        onNavigateToMessage={handleNavigateToMessage}
      />

      {/* Status for reply-to-original navigation across local/remote history. */}
      {isLoadingHighlightedMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-white dark:bg-dark-elevated rounded-full px-4 py-2 shadow-lg flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4 text-whatsapp-green"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm text-gray-700 dark:text-dark-text-primary">
            Finding original message...
          </span>
        </div>
      )}

      {isHighlightedMessageUnavailable && (
        <div
          className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg dark:border-amber-300/15 dark:bg-[#332f24] dark:text-amber-100"
          role="status"
          aria-live="polite"
        >
          <SearchX className="size-4" aria-hidden="true" />
          Original message is not available in synced history.
        </div>
      )}

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-20 bg-white dark:bg-dark-elevated rounded-full p-2 shadow-lg hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors"
          aria-label="Scroll to bottom"
        >
          <svg
            className="h-6 w-6 text-gray-600 dark:text-dark-text-secondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      )}

      {/* Background context menu */}
      {contextMenu && (
        <ChatContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onContactInfo={() => onOpenContactInfo?.()}
          onSelectMessages={enterSelectionMode}
        />
      )}
    </div>
  );
}

export default MessageThread;
