import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message } from "@whatsapp-web/shared";
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
}

interface UseMessageVirtualizationReturn {
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  items: VirtualItem[];
  totalSize: number;
  handleScroll: () => void;
  scrollToBottom: () => void;
  isAtBottom: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}

export function useMessageVirtualization({
  messages,
  conversationId,
  highlightedMessageId,
}: UseMessageVirtualizationOptions): UseMessageVirtualizationReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemsLengthRef = useRef(0);
  const isInitialScrollDone = useRef(false);

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
  }, [conversationId]);

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
        (item) => item.type === "message" && item.id === highlightedMessageId,
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

  return {
    virtualizer,
    scrollContainerRef,
    items,
    totalSize,
    handleScroll,
    scrollToBottom,
    isAtBottom,
  };
}
