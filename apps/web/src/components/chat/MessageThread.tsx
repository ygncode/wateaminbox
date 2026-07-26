import type { Message } from "@wateaminbox/shared";
import { useCallback, useState } from "react";
import { useTheme } from "../../contexts";
import { useMessageSelection } from "../../hooks/chat/useMessageSelection";
import { useMessageVirtualization } from "../../hooks/chat/useMessageVirtualization";
import { useInfiniteMessages } from "../../hooks/useInfiniteMessages";
import { useRetryMessage } from "../../hooks/useMessages";
import { ChatContextMenu } from "./ChatContextMenu";
import { MessageSelectionToolbar } from "./MessageSelectionToolbar";
import { VirtualMessageList } from "./VirtualMessageList";

const EMPTY_MESSAGES: Message[] = [];

interface MessageThreadProps {
  conversationId: string | undefined;
  currentUserId: string;
  isGroup?: boolean;
  /** ID of message to highlight and scroll to */
  highlightedMessageId?: string | null;
  /** Callback when user clicks "Contact info" in context menu */
  onOpenContactInfo?: () => void;
}

export function MessageThread({
  conversationId,
  currentUserId,
  isGroup = false,
  highlightedMessageId,
  onOpenContactInfo,
}: MessageThreadProps) {
  const retryMessage = useRetryMessage();
  const { resolvedTheme } = useTheme();
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
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

  const messages = data?.messages ?? EMPTY_MESSAGES;

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
  } = useMessageVirtualization({
    messages,
    conversationId,
    highlightedMessageId,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
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

  // Empty messages state
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-dark-primary">
        <div className="text-center max-w-md px-4">
          <div className="mb-4">
            <svg
              className="mx-auto h-16 w-16 text-gray-300 dark:text-dark-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-dark-text-secondary">
            No messages yet. Start the conversation!
          </p>
        </div>
      </div>
    );
  }

  // Background pattern colors based on theme
  const patternColor = resolvedTheme === "dark" ? "%231a2730" : "%23000000";
  const patternOpacity = resolvedTheme === "dark" ? "0.4" : "1";

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
        highlightedMessageId={highlightedMessageId}
        retryingMessageId={retryingMessageId}
        selectionMode={selectionMode}
        selectedMessageIds={selectedMessageIds}
        onMessageClick={handleMessageClick}
        onRetryMessage={handleRetry}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        onScroll={handleScroll}
        scrollContainerRef={scrollContainerRef}
        onBackgroundContextMenu={handleBackgroundContextMenu}
      />

      {/* Loading indicator for searching message */}
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
            Finding message...
          </span>
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
