import type { useVirtualizer, VirtualItem } from "@tanstack/react-virtual";
import {
  formatDateSeparator as formatDateSep,
  type RemoteHistoryStatus,
} from "@wateaminbox/shared";
import { ArchiveRestore, Loader2, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { GroupParticipant } from "@/hooks/useGroups";
import type { TeamMemberIdentity } from "@/hooks/useTeam";
import type { VirtualItem as MessageListItem } from "../../hooks/chat/useMessageVirtualization";
import { isChannel } from "@wateaminbox/shared";
import { channelDisplayName } from "@/components/connections/channel-catalog";
import { ChannelBadge } from "./ChannelIdentity";
import { MessageBubble } from "./MessageBubble";
import type { MessageNavigationTarget } from "./message-navigation";

type MessageVirtualizer = ReturnType<
  typeof useVirtualizer<HTMLDivElement, Element>
>;

interface VirtualMessageListProps {
  virtualRows: VirtualItem[];
  measureElement: MessageVirtualizer["measureElement"];
  items: MessageListItem[];
  totalSize: number;
  isGroup?: boolean;
  /** Thread id to the address it reaches, for the channel heading. */
  threadLabels?: ReadonlyMap<string, string>;
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
  /**
   * Whether the adapter can fetch history the server has not already stored.
   * Linked-device WhatsApp can ask the phone; a bot API has no such archive,
   * so the affordance is hidden rather than offered and then failing.
   */
  canLoadRemoteHistory?: boolean;
  isRequestingRemoteHistory?: boolean;
  remoteHistoryError?: string | null;
  onRequestRemoteHistory?: () => void;
  onScroll: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "mentionIds" | "displayName" | "contactId"
  >[];
  onNavigateToMessage?: (target: MessageNavigationTarget) => void;
}

export function VirtualMessageList({
  virtualRows,
  measureElement,
  items,
  totalSize,
  isGroup = false,
  threadLabels,
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
  canLoadRemoteHistory = true,
  isRequestingRemoteHistory,
  remoteHistoryError,
  onRequestRemoteHistory,
  onScroll,
  scrollContainerRef,
  onBackgroundContextMenu,
  mentionParticipants = [],
  onNavigateToMessage,
}: VirtualMessageListProps) {
  const { t } = useTranslation();

  return (
    <div
      ref={scrollContainerRef}
      // Wider gutters would eat the bubble width a phone needs; the column
      // still centres on tablet and desktop. Deliberately not a flex
      // container: the virtualiser's inner box is absolutely sized and must
      // not be shrunk by flex layout.
      className="relative z-10 mx-auto w-full min-h-0 max-w-4xl flex-1 overflow-y-auto px-2.5 pb-3 pt-2 sm:px-6 md:px-8"
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
            className="text-sm text-accent hover:underline"
          >
            {t("chat.loadOlderMessages", "Load older messages")}
          </button>
        </div>
      )}

      {canLoadRemoteHistory &&
        !hasNextPage &&
        remoteHistoryStatus === "requesting" && (
          <div
            className="mx-auto my-3 flex w-fit items-center gap-2 rounded-full border border-line/[0.06] bg-overlay/75 px-3.5 py-2 text-xs font-medium text-fg-muted shadow-sm backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin text-accent" />
            {t("chat.waitingForHistory", "Waiting for WhatsApp history…")}
          </div>
        )}

      {canLoadRemoteHistory &&
        !hasNextPage &&
        ["unknown", "available", "failed"].includes(remoteHistoryStatus) && (
          <div className="mx-auto my-3 flex max-w-md flex-col items-center gap-2 px-4 text-center">
            <button
              type="button"
              onClick={onRequestRemoteHistory}
              disabled={isRequestingRemoteHistory}
              className="group inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-overlay/80 px-4 text-xs font-semibold text-accent shadow-sm backdrop-blur transition hover:border-accent hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {isRequestingRemoteHistory ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArchiveRestore className="size-3.5 transition-transform group-hover:-translate-y-0.5" />
              )}
              {remoteHistoryStatus === "failed"
                ? t("chat.retryLoadOlder", "Try loading older messages again")
                : t(
                    "chat.loadOlderFromPhone",
                    "Load older messages from phone",
                  )}
            </button>
            {remoteHistoryError && (
              <p className="max-w-sm text-xs leading-5 text-warning">
                {remoteHistoryError}
              </p>
            )}
          </div>
        )}

      {!hasNextPage && remoteHistoryStatus === "exhausted" && (
        <div className="mx-auto my-3 flex w-fit items-center gap-2 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-fg-muted">
          <span className="h-px w-8 bg-current opacity-30" />
          {t("chat.beginningOfConversation", "Beginning of conversation")}
          <span className="h-px w-8 bg-current opacity-30" />
        </div>
      )}

      {canLoadRemoteHistory &&
        !hasNextPage &&
        remoteHistoryStatus === "unavailable" && (
          <div className="mx-auto my-3 flex max-w-sm items-center gap-2.5 rounded-xl border border-warning/30 bg-warning-soft/85 px-3.5 py-2.5 text-start text-xs leading-5 text-warning shadow-sm backdrop-blur">
            <Smartphone className="size-4 shrink-0 text-warning" />
            {t(
              "chat.earlierOnPrimaryPhone",
              "WhatsApp says earlier messages are only available on the primary phone.",
            )}
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
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-overlay/85 px-3 py-1 text-[11.5px] font-medium text-fg-muted shadow-xs backdrop-blur-sm">
                    {formatDateSep(item.date, t)}
                  </span>
                </div>
              </div>
            );
          }

          if (item.type === "channel") {
            const label = threadLabels?.get(item.threadId ?? "");
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
                {/* Announces the channel the run below arrived on, the way the
                    date separator announces a day. */}
                <div className="my-3 flex items-center justify-center gap-1.5">
                  {isChannel(item.channel) && (
                    <ChannelBadge channel={item.channel} iconOnly compact />
                  )}
                  <span className="text-[11.5px] font-medium text-fg-muted">
                    {channelDisplayName(item.channel)}
                    {label ? ` · ${label}` : ""}
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
                albumMessages={item.albumMessages}
                albumExpectedCount={item.albumExpectedCount}
                isOwn={item.message.senderType === "user"}
                isGroup={isGroup}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentUserAvatarUrl={currentUserAvatarUrl}
                currentUserGravatarUrl={currentUserGravatarUrl}
                teammateIdentities={teammateIdentities}
                onRetry={selectionMode ? undefined : onRetryMessage}
                isHighlighted={item.albumMessages.some(
                  (message) => highlightedMessageId === message.id,
                )}
                isRetrying={retryingMessageId === item.message.id}
                selectionMode={selectionMode}
                isSelected={selectedMessageIds.has(item.message.id)}
                onSelectionToggle={onMessageClick}
                mentionParticipants={mentionParticipants}
                onNavigateToMessage={onNavigateToMessage}
                groupPosition={item.groupPosition}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
