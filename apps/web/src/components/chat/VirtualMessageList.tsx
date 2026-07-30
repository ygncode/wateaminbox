import type { useVirtualizer, VirtualItem } from "@tanstack/react-virtual";
import {
  formatDateSeparator as formatDateSep,
  type RemoteHistoryStatus,
} from "@wateaminbox/shared";
import { ArchiveRestore, Loader2, Smartphone } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { GroupParticipant } from "@/hooks/useGroups";
import type { TeamMemberIdentity } from "@/hooks/useTeam";
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
  currentUserName?: string;
  currentUserAvatarUrl?: string;
  currentUserGravatarUrl?: string;
  teammateIdentities: ReadonlyMap<string, TeamMemberIdentity>;
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
  remoteHistoryStatus: RemoteHistoryStatus;
  isRequestingRemoteHistory?: boolean;
  remoteHistoryError?: string | null;
  onRequestRemoteHistory?: () => void;
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
  currentUserName,
  currentUserAvatarUrl,
  currentUserGravatarUrl,
  teammateIdentities,
  highlightedMessageId,
  retryingMessageId,
  selectionMode,
  selectedMessageIds,
  onMessageClick,
  onRetryMessage,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  remoteHistoryStatus,
  isRequestingRemoteHistory,
  remoteHistoryError,
  onRequestRemoteHistory,
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

      {!hasNextPage && remoteHistoryStatus === "requesting" && (
        <div
          className="mx-auto my-3 flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white/75 px-3.5 py-2 text-xs font-medium text-[#54656f] shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#202c33]/85 dark:text-dark-text-secondary"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin text-[#00a884]" />
          Waiting for WhatsApp history…
        </div>
      )}

      {!hasNextPage &&
        ["unknown", "available", "failed"].includes(remoteHistoryStatus) && (
          <div className="mx-auto my-3 flex max-w-md flex-col items-center gap-2 px-4 text-center">
            <button
              type="button"
              onClick={onRequestRemoteHistory}
              disabled={isRequestingRemoteHistory}
              className="group inline-flex h-9 items-center gap-2 rounded-full border border-[#c9d7d3] bg-white/80 px-4 text-xs font-semibold text-[#0b6b5d] shadow-sm backdrop-blur transition hover:border-[#00a884] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-[#202c33]/85 dark:text-[#53d8ba] dark:hover:border-[#00a884]/60 dark:hover:bg-[#26353d]"
            >
              {isRequestingRemoteHistory ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArchiveRestore className="size-3.5 transition-transform group-hover:-translate-y-0.5" />
              )}
              {remoteHistoryStatus === "failed"
                ? "Try loading older messages again"
                : "Load older messages from phone"}
            </button>
            {remoteHistoryError && (
              <p className="max-w-sm text-xs leading-5 text-amber-700 dark:text-amber-200">
                {remoteHistoryError}
              </p>
            )}
          </div>
        )}

      {!hasNextPage && remoteHistoryStatus === "exhausted" && (
        <div className="mx-auto my-3 flex w-fit items-center gap-2 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[#7a8b85] dark:text-dark-text-tertiary">
          <span className="h-px w-8 bg-current opacity-30" />
          Beginning of conversation
          <span className="h-px w-8 bg-current opacity-30" />
        </div>
      )}

      {!hasNextPage && remoteHistoryStatus === "unavailable" && (
        <div className="mx-auto my-3 flex max-w-sm items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/85 px-3.5 py-2.5 text-left text-xs leading-5 text-amber-900 shadow-sm backdrop-blur dark:border-amber-300/10 dark:bg-amber-300/[0.07] dark:text-amber-100">
          <Smartphone className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
          WhatsApp says earlier messages are only available on the primary
          phone.
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
                currentUserName={currentUserName}
                currentUserAvatarUrl={currentUserAvatarUrl}
                currentUserGravatarUrl={currentUserGravatarUrl}
                teammateIdentities={teammateIdentities}
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
