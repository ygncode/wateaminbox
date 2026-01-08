import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message } from "@whatsapp-web/shared";
import { formatDateSeparator as formatDateSep } from "@whatsapp-web/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../../contexts";
import { useInfiniteMessages } from "../../hooks/useInfiniteMessages";
import { useRetryMessage } from "../../hooks/useMessages";
import {
  selectSelectedMessageCount,
  selectSelectedMessageIds,
  selectSelectionMode,
  useChatStore,
} from "../../stores/chat-store";
import { ChatContextMenu } from "./ChatContextMenu";
import { MessageBubble } from "./MessageBubble";

interface MessageThreadProps {
  conversationId: string | undefined;
  currentUserId: string;
  onReplyToMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message) => void;
  onDeleteMessage?: (message: Message) => void;
  onStarMessage?: (message: Message) => void;
  onReactMessage?: (message: Message, emoji: string) => void;
  onRetryMessage?: (messageId: string) => void;
  /** ID of message to highlight and scroll to */
  highlightedMessageId?: string | null;
  /** Callback when user clicks "Contact info" in context menu */
  onOpenContactInfo?: () => void;
}

// Estimated row heights for virtualization
const ESTIMATED_MESSAGE_HEIGHT = 80;
const DATE_SEPARATOR_HEIGHT = 48;

export function MessageThread({
  conversationId,
  currentUserId: _currentUserId,
  onReplyToMessage,
  onForwardMessage,
  onDeleteMessage,
  onStarMessage,
  onReactMessage,
  onRetryMessage,
  highlightedMessageId,
  onOpenContactInfo,
}: MessageThreadProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const retryMessage = useRetryMessage();
  const { resolvedTheme } = useTheme();
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null
  );
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemsLengthRef = useRef(0);
  const isInitialScrollDone = useRef(false);

  // Selection mode state from store
  const selectionMode = useChatStore(selectSelectionMode);
  const selectedMessageIds = useChatStore(selectSelectedMessageIds);
  const selectedCount = useChatStore(selectSelectedMessageCount);
  const enterSelectionMode = useChatStore((state) => state.enterSelectionMode);
  const exitSelectionMode = useChatStore((state) => state.exitSelectionMode);
  const toggleMessageSelection = useChatStore(
    (state) => state.toggleMessageSelection
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteMessages(conversationId);

  const messages = data?.messages || [];

  // Group messages by date and flatten into virtual items - memoized to prevent re-renders
  const items = useMemo(() => {
    if (messages.length === 0) return [];

    const result: Array<
      | { type: "date"; date: string; id: string }
      | { type: "message"; message: Message; id: string }
    > = [];

    let currentDate = "";

    messages.forEach((message) => {
      const messageDate = new Date(message.createdAt).toDateString();

      if (messageDate !== currentDate) {
        currentDate = messageDate;
        result.push({
          type: "date",
          date: messageDate,
          id: `date-${messageDate}`,
        });
      }

      result.push({
        type: "message",
        message,
        id: message.id,
      });
    });

    return result;
  }, [messages]);

  // Memoize virtualizer callbacks to prevent re-renders
  const estimateSize = useCallback(
    (index: number) => {
      const item = items[index];
      if (item?.type === "date") return DATE_SEPARATOR_HEIGHT;
      return ESTIMATED_MESSAGE_HEIGHT;
    },
    [items]
  );

  const getItemKey = useCallback(
    (index: number) => items[index]?.id || index.toString(),
    [items]
  );

  // State for virtualizer total size to avoid flushSync warnings
  const [totalSize, setTotalSize] = useState(0);

  // Virtualizer setup
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan: 10,
    getItemKey,
    onChange: (instance) => {
      // Update total size asynchronously to avoid flushSync during render
      requestAnimationFrame(() => {
        setTotalSize(instance.getTotalSize());
      });
    },
  });

  // Initialize total size
  useEffect(() => {
    setTotalSize(virtualizer.getTotalSize());
  }, [virtualizer]);

  // Handle scroll to detect when we're near the top (for loading more)
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Load more when scrolling near the top
    if (container.scrollTop < 200 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }

    // Check if we're at the bottom
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;
    setIsAtBottom(isNearBottom);
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Scroll to bottom when new messages arrive (if already at bottom)
  useEffect(() => {
    // Only auto-scroll for new messages if initial scroll is done and user is at bottom
    if (
      isInitialScrollDone.current &&
      items.length > prevItemsLengthRef.current &&
      isAtBottom
    ) {
      // Use setTimeout to avoid flushSync being called during React's render cycle
      // (TanStack Virtual's scrollToIndex with smooth behavior triggers flushSync internally)
      const timeoutId = setTimeout(() => {
        virtualizer.scrollToIndex(items.length - 1, {
          align: "end",
          behavior: "smooth",
        });
      }, 0);
      prevItemsLengthRef.current = items.length;
      return () => clearTimeout(timeoutId);
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length, isAtBottom, virtualizer]);

  // Initial scroll to bottom when conversation loads
  useEffect(() => {
    if (conversationId && items.length > 0 && !isInitialScrollDone.current) {
      // Mark as done immediately to prevent duplicate scrolls
      isInitialScrollDone.current = true;

      // Small delay to allow virtualizer measurements to stabilize
      const timeoutId = setTimeout(() => {
        virtualizer.scrollToIndex(items.length - 1, { align: "end" });
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [conversationId, items.length, virtualizer]);

  // Reset initial scroll flag and items count when conversation changes
  useEffect(() => {
    isInitialScrollDone.current = false;
    prevItemsLengthRef.current = 0;
  }, []);

  // Store virtualizer in a ref to avoid dependency issues
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // Store items in a ref for the effect
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Scroll to highlighted message when it changes
  useEffect(() => {
    if (highlightedMessageId && itemsRef.current.length > 0) {
      const messageIndex = itemsRef.current.findIndex(
        (item) => item.type === "message" && item.id === highlightedMessageId
      );
      if (messageIndex !== -1) {
        virtualizerRef.current.scrollToIndex(messageIndex, {
          align: "center",
          behavior: "smooth",
        });
      }
    }
  }, [highlightedMessageId]);

  // Scroll to bottom button click
  const scrollToBottom = useCallback(() => {
    if (items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, {
        align: "end",
        behavior: "smooth",
      });
    }
  }, [items.length, virtualizer]);

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
    [retryMessage]
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

  // Handle message click in selection mode
  const handleMessageClick = useCallback(
    (messageId: string) => {
      if (selectionMode) {
        toggleMessageSelection(messageId);
      }
    },
    [selectionMode, toggleMessageSelection]
  );

  // ESC key to exit selection mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectionMode) {
        exitSelectionMode();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectionMode, exitSelectionMode]);

  // Exit selection mode when conversation changes
  useEffect(() => {
    if (selectionMode) {
      exitSelectionMode();
    }
  }, [exitSelectionMode, selectionMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
            WhatsApp Web
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
          <LoadingSpinner />
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
      {selectionMode && (
        <div className="sticky top-0 z-30 bg-whatsapp-teal-green text-white px-4 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-4">
            <button
              onClick={exitSelectionMode}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
              aria-label="Exit selection mode"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <span className="font-medium">
              {selectedCount === 0
                ? "Select messages"
                : `${selectedCount} selected`}
            </span>
          </div>
          <span className="text-sm opacity-80">Press ESC to cancel</span>
        </div>
      )}

      {/* WhatsApp-style background pattern */}
      <div
        className="absolute inset-0 opacity-5 dark:opacity-100"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='${patternColor}' fill-opacity='${patternOpacity}'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Virtualized message list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2 relative z-10"
        onScroll={handleScroll}
        onContextMenu={handleBackgroundContextMenu}
      >
        {/* Loading more indicator */}
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <LoadingSpinner size="sm" />
          </div>
        )}

        {/* Load more trigger area */}
        {hasNextPage && !isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => fetchNextPage()}
              className="text-sm text-whatsapp-teal-green hover:underline"
            >
              Load older messages
            </button>
          </div>
        )}

        {/* Virtual list container */}
        <div
          style={{
            height: `${totalSize}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];

            if (item.type === "date") {
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="flex justify-center my-4">
                    <span className="px-3 py-1 bg-white/80 dark:bg-dark-elevated/90 rounded-lg text-xs text-gray-600 dark:text-dark-text-secondary shadow-sm">
                      {formatDateSep(item.date)}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <MessageBubble
                  message={item.message}
                  isOwn={item.message.senderType === "user"}
                  onReply={selectionMode ? undefined : onReplyToMessage}
                  onForward={selectionMode ? undefined : onForwardMessage}
                  onDelete={selectionMode ? undefined : onDeleteMessage}
                  onStar={selectionMode ? undefined : onStarMessage}
                  onReact={selectionMode ? undefined : onReactMessage}
                  onRetry={
                    selectionMode ? undefined : onRetryMessage || handleRetry
                  }
                  isHighlighted={highlightedMessageId === item.message.id}
                  isRetrying={retryingMessageId === item.message.id}
                  selectionMode={selectionMode}
                  isSelected={selectedMessageIds.has(item.message.id)}
                  onSelectionToggle={handleMessageClick}
                />
              </div>
            );
          })}
        </div>
      </div>

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

// Loading spinner component
function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" }) {
  const sizeClasses = size === "sm" ? "h-5 w-5" : "h-8 w-8";

  return (
    <svg
      className={`animate-spin ${sizeClasses} text-whatsapp-green`}
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
  );
}

export default MessageThread;
