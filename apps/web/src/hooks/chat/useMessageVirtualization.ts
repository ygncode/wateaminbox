import {
  useVirtualizer,
  type VirtualItem as VirtualRow,
} from "@tanstack/react-virtual";
import type { Message, RemoteHistoryStatus } from "@wateaminbox/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupMediaAlbumMessages } from "@/components/chat/media-albums";
import {
  type BubbleGroupPosition,
  resolveBubbleGroupPositions,
} from "@/components/chat/message-grouping";
import {
  type MessageNavigationTarget,
  matchesMessageNavigationTarget,
} from "@/components/chat/message-navigation";
import { createBottomPin } from "./message-bottom-pin";
import { MESSAGE_LIST_END_ANCHOR } from "./message-list-end-anchor";
import { resolveNewestMessageAnchor } from "./message-scroll-anchor";

// Estimated row heights for virtualization
const ESTIMATED_MESSAGE_HEIGHT = 80;
const DATE_SEPARATOR_HEIGHT = 48;

export type VirtualItem =
  | { type: "date"; date: string; id: string }
  | {
      type: "message";
      message: Message;
      albumMessages: Message[];
      albumExpectedCount: number;
      id: string;
      /** Position in its run of same-author messages; see message-grouping.ts. */
      groupPosition: BubbleGroupPosition;
    };

interface UseMessageVirtualizationOptions {
  messages: Message[];
  conversationId: string | undefined;
  highlightedMessageId?: string | null;
  navigationTarget?: MessageNavigationTarget | null;
  /** Changes when navigation to the same highlighted message is requested again. */
  highlightRequestKey?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  remoteHistoryStatus?: RemoteHistoryStatus;
  isRequestingRemoteHistory?: boolean;
  requestRemoteHistory?: () => void;
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
  isHighlightedMessageUnavailable: boolean;
}

export function useMessageVirtualization({
  messages,
  conversationId,
  highlightedMessageId,
  navigationTarget,
  highlightRequestKey,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  remoteHistoryStatus = "unknown",
  isRequestingRemoteHistory = false,
  requestRemoteHistory,
}: UseMessageVirtualizationOptions): UseMessageVirtualizationReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevItemsLengthRef = useRef(0);
  // Conversation whose initial anchor already ran. See resolveNewestMessageAnchor
  // for why this is keyed by id instead of a boolean flag.
  const anchoredConversationIdRef = useRef<string | null>(null);
  const [isLoadingHighlightedMessage, setIsLoadingHighlightedMessage] =
    useState(false);
  const [isHighlightedMessageUnavailable, setIsHighlightedMessageUnavailable] =
    useState(false);
  const pendingHighlightedMessageIdRef = useRef<string | null>(null);
  const remoteRequestItemCountRef = useRef<number | null>(null);
  // App-level "viewport belongs at the newest message" intent. See
  // message-bottom-pin.ts for the clamped-write race it reconciles.
  const bottomPinRef = useRef(createBottomPin());

  // Group messages by date and flatten into virtual items - memoized to prevent re-renders
  const items = useMemo<VirtualItem[]>(() => {
    if (messages.length === 0) return [];

    const rows: (ReturnType<typeof groupMediaAlbumMessages>[number] | null)[] =
      [];
    let currentDate = "";

    groupMediaAlbumMessages(messages).forEach((album) => {
      const messageDate = new Date(album.primary.createdAt).toDateString();
      // A date separator is a `null` row so grouping sees it and refuses to
      // continue a run across the day boundary.
      if (messageDate !== currentDate) {
        currentDate = messageDate;
        rows.push(null);
      }
      rows.push(album);
    });

    const positions = resolveBubbleGroupPositions(
      rows.map((album) => album?.primary ?? null),
    );

    return rows.map((album, index): VirtualItem => {
      if (!album) {
        // A separator is always immediately followed by the first message of
        // the day it announces.
        const date = new Date(
          rows[index + 1]!.primary.createdAt,
        ).toDateString();
        return { type: "date", date, id: `date-${date}` };
      }
      return {
        type: "message",
        message: album.primary,
        albumMessages: album.messages,
        albumExpectedCount: album.expectedCount,
        id: album.id,
        groupPosition: positions[index] ?? "single",
      };
    });
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
    // Keep the viewport pinned to the newest message when media rows grow
    // after their lazily loaded asset decodes. See message-list-end-anchor.ts.
    ...MESSAGE_LIST_END_ANCHOR,
  });

  // TanStack's getters may notify the React adapter when their memoized inputs
  // change. Read them in the component that owns useVirtualizer instead of in a
  // child render to avoid cross-component render updates.
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Store virtualizer in a ref to avoid dependency issues
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // Store items in a ref for the effect
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Read during the initial anchor effect without re-running it whenever a
  // highlight target changes later in the same conversation.
  const hasHighlightTargetRef = useRef(false);
  hasHighlightTargetRef.current = Boolean(
    navigationTarget?.messageId ?? highlightedMessageId,
  );

  // Re-checks the true DOM bottom while the pin holds and reasserts it when
  // content grew underneath the viewport (late media decodes, clamped
  // end-anchor writes). Runs on every scroll event and after every commit
  // that changed measured sizes.
  const reconcileBottomPin = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const decision = bottomPinRef.current.observe({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    });
    if (decision === "repin") {
      // The browser clamps to the maximum scroll offset.
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Handle scroll to detect when we're near the top (for loading more) and bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    reconcileBottomPin();

    // Check if we're at the bottom (reading scrollTop after a possible repin
    // so the scroll-down button doesn't flicker mid-reconciliation).
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;
    setIsAtBottom(isNearBottom);
  }, [reconcileBottomPin]);

  // Reset viewport state when the conversation changes. The initial anchor is
  // guarded by conversation id, so it no longer depends on this effect running
  // before the anchor effect.
  useEffect(() => {
    prevItemsLengthRef.current = 0;
    setIsAtBottom(true);
    // Forget the previous conversation's viewport so its scroll offsets are
    // not misread as this conversation's upward scroll.
    bottomPinRef.current.reset();
  }, [conversationId]);

  // `totalSize` changes exactly when rows re-measure (estimates → real
  // heights, late media decodes) — the moments the end-anchor's clamped
  // scrollTop writes can strand the viewport short of the newest message.
  // This runs after React committed the grown inner box, so the true bottom
  // is reachable again. `totalSize` is intentionally the trigger, not an
  // input read by the effect.
  useEffect(() => {
    reconcileBottomPin();
  }, [totalSize, reconcileBottomPin]);

  // Scroll to bottom when new messages arrive (if already at bottom)
  useEffect(() => {
    // Only auto-scroll for new messages if initial scroll is done and user is at bottom
    if (
      anchoredConversationIdRef.current === conversationId &&
      items.length > prevItemsLengthRef.current &&
      isAtBottom
    ) {
      bottomPinRef.current.intend();
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
  }, [conversationId, items.length, isAtBottom, virtualizer]);

  // Anchor the thread to the newest message once a conversation's messages are
  // available. TanStack keeps reconciling the target while rows are measured,
  // so one call still lands at the bottom for taller group rows.
  useEffect(() => {
    const anchor = resolveNewestMessageAnchor({
      conversationId,
      anchoredConversationId: anchoredConversationIdRef.current,
      itemCount: items.length,
      hasHighlightTarget: hasHighlightTargetRef.current,
    });

    if (anchor === "wait" || anchor === "already-anchored") return;

    // Claim the anchor before scrolling so re-renders cannot repeat it.
    anchoredConversationIdRef.current = conversationId ?? null;

    if (anchor === "newest-message") {
      bottomPinRef.current.intend();
      virtualizer.scrollToIndex(items.length - 1, {
        align: "end",
        behavior: "auto",
      });
    } else {
      // "highlighted-message": the navigation target owns the viewport.
      bottomPinRef.current.release();
    }
  }, [conversationId, items.length, virtualizer]);

  useEffect(() => {
    pendingHighlightedMessageIdRef.current = null;
    remoteRequestItemCountRef.current = null;
    setIsHighlightedMessageUnavailable(false);
  }, [
    highlightedMessageId,
    navigationTarget?.kind,
    navigationTarget?.messageId,
    highlightRequestKey,
  ]);

  // Scroll to highlighted messages. Unresolved reply references first search
  // every local page, then request older pages from the primary phone while
  // each request continues to add messages.
  useEffect(() => {
    const searchKey =
      navigationTarget?.messageId ?? highlightedMessageId ?? null;
    if (!searchKey || itemsRef.current.length === 0) {
      setIsLoadingHighlightedMessage(false);
      pendingHighlightedMessageIdRef.current = null;
      return;
    }

    const messageIndex = itemsRef.current.findIndex(
      (item) =>
        item.type === "message" &&
        item.albumMessages.some((message) =>
          navigationTarget
            ? matchesMessageNavigationTarget(message, navigationTarget)
            : message.id === highlightedMessageId,
        ),
    );

    if (messageIndex !== -1) {
      setIsLoadingHighlightedMessage(false);
      setIsHighlightedMessageUnavailable(false);
      pendingHighlightedMessageIdRef.current = null;
      // Centering an older message must not fight a held bottom pin.
      bottomPinRef.current.release();
      virtualizerRef.current.scrollToIndex(messageIndex, {
        align: "center",
        behavior: "auto",
      });
      return;
    }

    if (hasNextPage) {
      setIsLoadingHighlightedMessage(true);
      setIsHighlightedMessageUnavailable(false);
      pendingHighlightedMessageIdRef.current = searchKey;
      if (!isFetchingNextPage && fetchNextPage) {
        fetchNextPage();
      }
      return;
    }

    // A database target came from an already-resolved quote, so it must be in
    // local pagination. Only unresolved WhatsApp references can benefit from
    // requesting history from the primary phone.
    if (navigationTarget?.kind !== "reference") {
      setIsLoadingHighlightedMessage(false);
      pendingHighlightedMessageIdRef.current = null;
      return;
    }

    if (isRequestingRemoteHistory || remoteHistoryStatus === "requesting") {
      setIsLoadingHighlightedMessage(true);
      setIsHighlightedMessageUnavailable(false);
      return;
    }

    const canRequestRemoteHistory = ["unknown", "available", "failed"].includes(
      remoteHistoryStatus,
    );
    if (canRequestRemoteHistory && requestRemoteHistory) {
      // If WhatsApp completed a request without adding a row, repeating the
      // same anchor would loop forever. A second click resets this guard.
      if (remoteRequestItemCountRef.current === itemsRef.current.length) {
        setIsLoadingHighlightedMessage(false);
        setIsHighlightedMessageUnavailable(true);
        return;
      }
      remoteRequestItemCountRef.current = itemsRef.current.length;
      setIsLoadingHighlightedMessage(true);
      setIsHighlightedMessageUnavailable(false);
      requestRemoteHistory();
      return;
    }

    setIsLoadingHighlightedMessage(false);
    setIsHighlightedMessageUnavailable(true);
    pendingHighlightedMessageIdRef.current = null;
  }, [
    highlightedMessageId,
    navigationTarget,
    highlightRequestKey,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    remoteHistoryStatus,
    isRequestingRemoteHistory,
    requestRemoteHistory,
  ]);

  // Scroll to bottom button click
  const scrollToBottom = useCallback(() => {
    if (items.length > 0) {
      // Hold the pin so measurement changes during the jump keep
      // reconciling until the viewport reaches the true bottom.
      bottomPinRef.current.intend();
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
    isHighlightedMessageUnavailable,
  };
}
