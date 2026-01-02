import { useRef, useEffect, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message } from "@whatsapp-web/shared";
import { useInfiniteMessages } from "../../hooks/useInfiniteMessages";
import { MessageBubble } from "./MessageBubble";

interface MessageThreadProps {
  conversationId: string | undefined;
  currentUserId: string;
  onReplyToMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message) => void;
  onDeleteMessage?: (message: Message) => void;
  onStarMessage?: (message: Message) => void;
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
}: MessageThreadProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevMessagesLengthRef = useRef(0);
  const isInitialScrollDone = useRef(false);

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

  // Group messages by date and flatten into virtual items
  const virtualItems = useCallback(() => {
    if (messages.length === 0) return [];

    const items: Array<
      | { type: "date"; date: string; id: string }
      | { type: "message"; message: Message; id: string }
    > = [];

    let currentDate = "";

    messages.forEach((message) => {
      const messageDate = new Date(message.createdAt).toDateString();

      if (messageDate !== currentDate) {
        currentDate = messageDate;
        items.push({
          type: "date",
          date: messageDate,
          id: `date-${messageDate}`,
        });
      }

      items.push({
        type: "message",
        message,
        id: message.id,
      });
    });

    return items;
  }, [messages]);

  const items = virtualItems();

  // Virtualizer setup
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const item = items[index];
      if (item?.type === "date") return DATE_SEPARATOR_HEIGHT;
      return ESTIMATED_MESSAGE_HEIGHT;
    },
    overscan: 10,
    getItemKey: (index) => items[index]?.id || index.toString(),
  });

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
    if (messages.length > prevMessagesLengthRef.current && isAtBottom) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop =
            scrollContainerRef.current.scrollHeight;
        }
      });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, isAtBottom]);

  // Initial scroll to bottom when conversation loads
  useEffect(() => {
    if (conversationId && messages.length > 0 && !isInitialScrollDone.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop =
            scrollContainerRef.current.scrollHeight;
          isInitialScrollDone.current = true;
        }
      });
    }
  }, [conversationId, messages.length]);

  // Reset initial scroll flag when conversation changes
  useEffect(() => {
    isInitialScrollDone.current = false;
  }, [conversationId]);

  // Scroll to bottom button click
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  // Empty state when no chat selected
  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-4">
          <div className="mb-4">
            <svg
              className="mx-auto h-24 w-24 text-gray-300"
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
          <h2 className="text-xl font-semibold text-gray-600 mb-2">
            WhatsApp Web
          </h2>
          <p className="text-gray-500">
            Select a conversation to start messaging
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <LoadingSpinner />
          <p className="text-sm text-gray-500">Loading messages...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
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
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            Failed to load messages
          </h3>
          <p className="text-sm text-gray-500">
            {error instanceof Error ? error.message : "An error occurred"}
          </p>
        </div>
      </div>
    );
  }

  // Empty messages state
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-4">
          <div className="mb-4">
            <svg
              className="mx-auto h-16 w-16 text-gray-300"
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
          <p className="text-gray-500">
            No messages yet. Start the conversation!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative flex flex-col bg-[#e5ddd5]">
      {/* WhatsApp-style background pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Virtualized message list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-2 relative z-10"
        onScroll={handleScroll}
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
            height: `${virtualizer.getTotalSize()}px`,
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
                    <span className="px-3 py-1 bg-white/80 rounded-lg text-xs text-gray-600 shadow-sm">
                      {formatDateSeparator(item.date)}
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
                  onReply={onReplyToMessage}
                  onForward={onForwardMessage}
                  onDelete={onDeleteMessage}
                  onStar={onStarMessage}
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
          className="absolute bottom-4 right-4 z-20 bg-white rounded-full p-2 shadow-lg hover:bg-gray-50 transition-colors"
          aria-label="Scroll to bottom"
        >
          <svg
            className="h-6 w-6 text-gray-600"
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
    </div>
  );
}

// Helper function to format date separator
function formatDateSeparator(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
