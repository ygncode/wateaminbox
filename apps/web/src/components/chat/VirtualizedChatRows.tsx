import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import type { Chat, ChatListItemProps } from "../../types/chat";
import { ChatListItem } from "./ChatListItem";
import { anchoredChatScrollTop } from "./chat-list-anchor";

const CHAT_ITEM_HEIGHT = 76;
interface Props {
  chats: Chat[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /**
   * The same element as `scrollContainerRef`, held in the parent's state so
   * this component re-renders once it is attached (see ChatList).
   */
  scrollElement: HTMLDivElement | null;
  scrollPositionRef: RefObject<number>;
  selectedChatId?: string;
  onChatSelect: (id: string) => void;
  onPrefetch: ChatListItemProps["onPrefetch"];
  hasPreviousPage: boolean;
}

// Stable row props keep the expensive avatar/preview subtree out of scroll-only
// renders. The list filters and dialogs no longer rerender on every scroll tick.
const SelectableRow = memo(function SelectableRow({
  chat,
  selectedChatId,
  onChatSelect,
  onPrefetch,
}: Pick<Props, "selectedChatId" | "onChatSelect" | "onPrefetch"> & {
  chat: Chat;
}) {
  return (
    <ChatListItem
      chat={chat}
      isSelected={
        chat.id === selectedChatId ||
        chat.contact.id === selectedChatId ||
        chat.contact.conversationId === selectedChatId
      }
      onClick={() => onChatSelect(chat.contact.conversationId ?? chat.id)}
      onPrefetch={onPrefetch}
    />
  );
});

export const VirtualizedChatRows = memo(function VirtualizedChatRows({
  chats,
  scrollContainerRef,
  scrollElement,
  scrollPositionRef,
  selectedChatId,
  onChatSelect,
  onPrefetch,
  hasPreviousPage,
}: Props) {
  const previous = useRef({ chats, hasPreviousPage });
  // Capture before the DOM commit can clamp scrollTop to a shorter window.
  const oldScrollTop = scrollContainerRef.current?.scrollTop ?? 0;
  useLayoutEffect(() => {
    const root = scrollContainerRef.current;
    if (root && previous.current.chats !== chats) {
      root.scrollTop = anchoredChatScrollTop(
        previous.current.chats,
        chats,
        oldScrollTop,
        CHAT_ITEM_HEIGHT,
        previous.current.hasPreviousPage || hasPreviousPage,
      );
      scrollPositionRef.current = root.scrollTop;
    }
    previous.current = { chats, hasPreviousPage };
  }, [
    chats,
    hasPreviousPage,
    oldScrollTop,
    scrollContainerRef,
    scrollPositionRef,
  ]);

  const getItemKey = useCallback((index: number) => chats[index].id, [chats]);
  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scrollElement ?? scrollContainerRef.current,
    estimateSize: () => CHAT_ITEM_HEIGHT,
    overscan: 5,
    getItemKey,
  });
  return (
    <div
      style={{
        height: virtualizer.getTotalSize(),
        width: "100%",
        position: "relative",
        overflowAnchor: "none",
      }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-chat-id={chats[row.index].id}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: row.size,
            transform: `translateY(${row.start}px)`,
          }}
        >
          <SelectableRow
            chat={chats[row.index]}
            selectedChatId={selectedChatId}
            onChatSelect={onChatSelect}
            onPrefetch={onPrefetch}
          />
        </div>
      ))}
    </div>
  );
});
