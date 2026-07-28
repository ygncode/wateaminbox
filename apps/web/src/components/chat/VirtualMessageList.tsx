import type { useVirtualizer, VirtualItem } from "@tanstack/react-virtual";
import { formatDateSeparator as formatDateSep } from "@wateaminbox/shared";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { GroupParticipant } from "@/hooks/useGroups";
import type { VirtualItem as MessageListItem } from "../../hooks/chat/useMessageVirtualization";
import { MessageBubble } from "./MessageBubble";

type MessageVirtualizer = ReturnType<
  typeof useVirtualizer<HTMLDivElement, Element>
>;

interface VirtualMessageListProps {
  virtualRows: VirtualItem[];
  measureElement: MessageVirtualizer["measureElement"];
  items: MessageListItem[];
  totalSize: number;
  isGroup?: boolean;
  currentUserId: string;
  highlightedMessageId?: string | null;
  retryingMessageId: string | null;
  selectionMode: boolean;
  selectedMessageIds: Set<string>;
  onMessageClick: (messageId: string) => void;
  /** Retry handler is local to MessageThread so passed directly */
  onRetryMessage?: (messageId: string) => void;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  onScroll: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "displayName"
  >[];
  onNavigateToMessage?: (messageId: string) => void;
}

export function VirtualMessageList({
  virtualRows,
  measureElement,
  items,
  totalSize,
  isGroup = false,
  currentUserId,
  highlightedMessageId,
  retryingMessageId,
  selectionMode,
  selectedMessageIds,
  onMessageClick,
  onRetryMessage,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  onScroll,
  scrollContainerRef,
  onBackgroundContextMenu,
  mentionParticipants = [],
  onNavigateToMessage,
}: VirtualMessageListProps) {
  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 min-h-0 overflow-y-auto px-4 py-2 relative z-10"
      onScroll={onScroll}
      onContextMenu={onBackgroundContextMenu}
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
            onClick={() => fetchNextPage?.()}
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
        {virtualRows.map((virtualRow) => {
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
              ref={measureElement}
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
                isGroup={isGroup}
                currentUserId={currentUserId}
                onRetry={selectionMode ? undefined : onRetryMessage}
                isHighlighted={highlightedMessageId === item.message.id}
                isRetrying={retryingMessageId === item.message.id}
                selectionMode={selectionMode}
                isSelected={selectedMessageIds.has(item.message.id)}
                onSelectionToggle={onMessageClick}
                mentionParticipants={mentionParticipants}
                onNavigateToMessage={onNavigateToMessage}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
