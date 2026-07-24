import {
  useVirtualizer,
  type VirtualItem as VirtualRow,
} from "@tanstack/react-virtual";
import type { Message } from "@wateaminbox/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Estimated row heights for virtualization
const ESTIMATED_MESSAGE_HEIGHT = 80;
const DATE_SEPARATOR_HEIGHT = 48;

export type VirtualItem =
  | { type: "date"; date: string; id: string }
  | { type: "message"; message: Message; id: string };

interface UseMessageVirtualizationOptions {
  messages: Message[];
  conversationId: string | undefined;
  highlightedMessageId?: string | null;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}

interface UseMessageVirtualizationReturn {
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  items: VirtualItem[];
  virtualRows: VirtualRow[];
  totalSize: number;
  handleScroll: () => void;
  scrollToBottom: () => void;
  isAtBottom: boolean;
  isLoadingHighlightedMessage: boolean;
}

export function useMessageVirtualization({
  messages,
  conversationId,
  highlightedMessageId,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: UseMessageVirtualizationOptions): UseMessageVirtualizationReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemsLengthRef = useRef(0);
  const isInitialScrollDone = useRef(false);
  const [isLoadingHighlightedMessage, setIsLoadingHighlightedMessage] =
    useState(false);
  const pendingHighlightedMessageIdRef = useRef<string | null>(null);

  // Group messages by date and flatten into virtual items - memoized to prevent re-renders
  const items = useMemo<VirtualItem[]>(() => {
    if (messages.length === 0) return [];

    const result: VirtualItem[] = [];
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
    [items],
  );

  const getItemKey = useCallback(
    (index: number) => items[index]?.id || index.toString(),
    [items],
  );

  // Virtualizer setup
  const virtualizer = useVirtualizer({
    // React 19 can invoke this render while another lifecycle update is active.
    // Let React schedule TanStack's notification instead of forcing flushSync.
    useFlushSync: false,
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan: 10,
    getItemKey,
  });

  // TanStack's getters may notify the React adapter when their memoized inputs
  // change. Read them in the component that owns useVirtualizer instead of in a
  // child render to avoid cross-component render updates.
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Handle scroll to detect when we're near the top (for loading more) and bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Check if we're at the bottom
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;
    setIsAtBottom(isNearBottom);
  }, []);

  // Scroll to bottom when new messages arrive (if already at bottom)
  useEffect(() => {
    // Only auto-scroll for new messages if initial scroll is done and user is at bottom
    if (
      isInitialScrollDone.current &&
      items.length > prevItemsLengthRef.current &&
      isAtBottom
    ) {
      // Use setTimeout to ensure scroll happens after render cycle completes
      const timeoutId = setTimeout(() => {
        virtualizer.scrollToIndex(items.length - 1, {
          align: "end",
          behavior: "auto",
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
  }, [conversationId]);

  // Store virtualizer in a ref to avoid dependency issues
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // Store items in a ref for the effect
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Scroll to highlighted message with auto-loading if not in view
  useEffect(() => {
    if (!highlightedMessageId || itemsRef.current.length === 0) {
      setIsLoadingHighlightedMessage(false);
      pendingHighlightedMessageIdRef.current = null;
      return;
    }

    // Check if message exists in current items
    const messageIndex = itemsRef.current.findIndex(
      (item) => item.type === "message" && item.id === highlightedMessageId,
    );

    if (messageIndex !== -1) {
      // Message found - scroll to it and clear loading state
      setIsLoadingHighlightedMessage(false);
      pendingHighlightedMessageIdRef.current = null;
      virtualizerRef.current.scrollToIndex(messageIndex, {
        align: "center",
        behavior: "auto",
      });
    } else if (hasNextPage && !isFetchingNextPage && fetchNextPage) {
      // Message not found but more pages available - load next page
      // Track that we're looking for this message to avoid duplicate fetches
      if (pendingHighlightedMessageIdRef.current !== highlightedMessageId) {
        pendingHighlightedMessageIdRef.current = highlightedMessageId;
        setIsLoadingHighlightedMessage(true);
      }

      // Only fetch if not already fetching
      if (!isFetchingNextPage) {
        fetchNextPage();
      }
    } else {
      // Message not found and no more pages - clear loading state
      setIsLoadingHighlightedMessage(false);
      pendingHighlightedMessageIdRef.current = null;
    }
  }, [highlightedMessageId, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Scroll to bottom button click
  const scrollToBottom = useCallback(() => {
    if (items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, {
        align: "end",
        behavior: "auto",
      });
    }
  }, [items.length, virtualizer]);

  return {
    virtualizer,
    scrollContainerRef,
    items,
    virtualRows,
    totalSize,
    handleScroll,
    scrollToBottom,
    isAtBottom,
    isLoadingHighlightedMessage,
  };
}
