import type { Message } from "@wateaminbox/shared";
import { formatMessageTime } from "@wateaminbox/shared";
import type { TFunction } from "i18next";
import { Smartphone } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import type { GroupParticipant } from "@/hooks/useGroups";
import type { TeamMemberIdentity } from "@/hooks/useTeam";
import { cn, formatPhoneLikeText } from "@/lib/utils";
import { useMessageActions } from "../../contexts";
import { useClickOutside } from "../../hooks/ui";
import type { MentionParticipant } from "./group-mentions";
import {
  type ParticipantIdentity,
  resolveParticipantContactId,
} from "./group-participant-identity";
import { LinkifiedText } from "./LinkifiedText";
import { MessageContent } from "./MessageContent";
import {
  type BubbleGroupPosition,
  endsGroup,
  startsGroup,
} from "./message-grouping";

// Lazy load emoji reaction picker - only loaded when user opens it
const EmojiReactionPicker = lazy(() => import("./EmojiReactionPicker"));

import { MessageContextMenu } from "./MessageContextMenu";
import { ForwardIcon, ReplyIcon, StarFilledIcon } from "./MessageIcons";
import { MessageReactions } from "./MessageReactions";
import { getErrorMessage, MessageStatusIcon } from "./MessageStatusIcon";
import {
  getReplyNavigationTarget,
  type MessageNavigationTarget,
} from "./message-navigation";
import {
  isDoubleTouchTap,
  isInteractiveMessageTarget,
  isMobileReactionSurface,
  type TouchTap,
} from "./mobile-message-gestures";

/**
 * Bubble fills.
 *
 * Outgoing used to be solid `whatsapp-green` with white text, which is 1.8:1
 * and the single most repeated element in the product. Both themes now use
 * the fills the app's own conversation skeleton already previews - pale green
 * on dark ink in light mode, deep teal on light ink in dark mode - so bubble
 * text, links, ticks and sender labels all inherit a colour that reads.
 */
const OWN_BUBBLE_CLASS =
  "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-dark-text-primary";
const INCOMING_BUBBLE_CLASS =
  "bg-white text-[#111b21] dark:bg-dark-elevated dark:text-dark-text-primary";

/**
 * Only the first bubble of a run carries a tail; the rest are fully rounded,
 * which is what makes a run read as one block instead of five separate cards.
 */
function bubbleRadiusClass(
  isOwn: boolean,
  position: BubbleGroupPosition,
): string {
  if (!startsGroup(position)) return "rounded-[1.15rem]";
  return isOwn
    ? "rounded-[1.15rem] rounded-tr-[0.35rem]"
    : "rounded-[1.15rem] rounded-tl-[0.35rem]";
}

export function shouldShowReplyPreview(
  message: Pick<Message, "replyToMessageId" | "isDeleted">,
): boolean {
  return Boolean(message.replyToMessageId && !message.isDeleted);
}

interface MessageBubbleProps {
  message: Message;
  /** Consecutive WhatsApp album children collapsed into this bubble. */
  albumMessages?: Message[];
  albumExpectedCount?: number;
  isOwn: boolean;
  /** Whether the active conversation is a WhatsApp group. */
  isGroup?: boolean;
  /** Authenticated teammate viewing the thread. */
  currentUserId: string;
  /** Display name and profile image for the authenticated teammate. */
  currentUserName?: string;
  currentUserAvatarUrl?: string;
  currentUserGravatarUrl?: string;
  /** Workspace teammate profiles keyed by user ID. */
  teammateIdentities: ReadonlyMap<string, TeamMemberIdentity>;
  /** Retry handler passed directly (local to MessageThread) */
  onRetry?: (messageId: string) => void;
  /** Highlight this message (e.g., from search) */
  isHighlighted?: boolean;
  isRetrying?: boolean;
  /** Whether selection mode is active */
  selectionMode?: boolean;
  /** Whether this message is selected */
  isSelected?: boolean;
  /** Callback when message selection is toggled */
  onSelectionToggle?: (messageId: string) => void;
  /** Resolved group members used to display WhatsApp mentions by name. */
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "mentionIds" | "displayName" | "contactId"
  >[];
  /** Navigate the thread to the original message referenced by a reply. */
  onNavigateToMessage?: (target: MessageNavigationTarget) => void;
  /**
   * Where this bubble sits in its run of same-author messages. Drives the
   * gap above it, its tail, and whether it repeats the sender's name and
   * avatar. See `message-grouping.ts`.
   */
  groupPosition?: BubbleGroupPosition;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  albumMessages = [message],
  albumExpectedCount = albumMessages.length,
  isOwn,
  isGroup = false,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  currentUserGravatarUrl,
  teammateIdentities,
  onRetry,
  isHighlighted = false,
  isRetrying = false,
  selectionMode = false,
  isSelected = false,
  onSelectionToggle,
  mentionParticipants = [],
  onNavigateToMessage,
  groupPosition = "single",
}: MessageBubbleProps) {
  // Get message actions from context (eliminates prop drilling)
  const { onReply, onForward, onDelete, onStar, onReact } = useMessageActions();
  const { t } = useTranslation();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const lastTouchTapRef = useRef<TouchTap | null>(null);

  // Both context menu and reaction picker use fixed positioning with viewport coordinates
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [reactionPickerPosition, setReactionPickerPosition] = useState({
    x: 0,
    y: 0,
  });

  // Close context menu when clicking outside
  useClickOutside(contextMenuRef, () => setShowContextMenu(false), {
    enabled: showContextMenu,
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (message.isDeleted) return;

      // Use viewport coordinates (clientX/clientY) for fixed positioning
      setContextMenuPosition({
        x: e.clientX,
        y: e.clientY,
      });
      setShowContextMenu(true);
    },
    [message.isDeleted],
  );

  const handleReactionClick = useCallback(() => {
    if (!onReact || message.isDeleted || selectionMode) return;

    // Calculate viewport coordinates for fixed positioning
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) {
      // Calculate picker width (approximately 350px for the quick reactions bar)
      const PICKER_WIDTH = 350;
      const PICKER_HEIGHT = 50;
      const VIEWPORT_PADDING = 10;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Position picker above the bubble, aligned with the bubble
      let x = isOwn ? rect.right - PICKER_WIDTH : rect.left;
      let y = rect.top - PICKER_HEIGHT - 10;

      // Adjust for viewport boundaries
      if (x + PICKER_WIDTH > viewportWidth - VIEWPORT_PADDING) {
        x = viewportWidth - PICKER_WIDTH - VIEWPORT_PADDING;
      }
      if (x < VIEWPORT_PADDING) {
        x = VIEWPORT_PADDING;
      }
      // If no room above, position below the bubble
      if (y < VIEWPORT_PADDING) {
        y = rect.bottom + 10;
      }
      // If still no room, center vertically
      if (y + PICKER_HEIGHT > viewportHeight - VIEWPORT_PADDING) {
        y = Math.max(VIEWPORT_PADDING, (viewportHeight - PICKER_HEIGHT) / 2);
      }

      setReactionPickerPosition({ x, y });
    }
    setShowReactionPicker(true);
    setShowContextMenu(false);
  }, [isOwn, message.isDeleted, onReact, selectionMode]);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.pointerType !== "touch" ||
        !onReact ||
        message.isDeleted ||
        selectionMode ||
        isInteractiveMessageTarget(event.target)
      ) {
        lastTouchTapRef.current = null;
        return;
      }

      const tap = { at: Date.now(), x: event.clientX, y: event.clientY };
      const previousTap = lastTouchTapRef.current;
      lastTouchTapRef.current = tap;
      if (!previousTap || !isDoubleTouchTap(previousTap, tap)) return;

      lastTouchTapRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      handleReactionClick();
    },
    [handleReactionClick, message.isDeleted, onReact, selectionMode],
  );

  // Some mobile browsers synthesize dblclick rather than exposing the two
  // touch pointer events consistently. Keep that path mobile-only so desktop
  // text selection remains unchanged.
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        !isMobileReactionSurface() ||
        isInteractiveMessageTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleReactionClick();
    },
    [handleReactionClick],
  );

  const handleSelectReaction = useCallback(
    (emoji: string) => {
      onReact?.(message, emoji);
      setShowReactionPicker(false);
    },
    [message, onReact],
  );

  // Check if message has reactions for extra bottom margin
  const hasReactions = message.reactions && message.reactions.length > 0;

  // Handle click in selection mode
  const handleClick = useCallback(() => {
    if (selectionMode && onSelectionToggle) {
      onSelectionToggle(message.id);
    }
  }, [selectionMode, onSelectionToggle, message.id]);

  const isRunContinuation =
    groupPosition === "middle" || groupPosition === "last";
  const isRunStart = startsGroup(groupPosition);
  const isRunEnd = endsGroup(groupPosition);
  // The timestamp shares the last text line when it fits, the way a phone
  // messenger does; media and system-ish rows keep their own meta row because
  // their content is not part of an inline formatting context.
  const hasInlineMeta = !message.isDeleted && message.messageType === "text";
  const meta = <MessageMeta message={message} isOwn={isOwn} variant="inline" />;

  return (
    <div
      className={cn(
        "group flex",
        isOwn ? "justify-end" : "justify-start",
        // Tight inside a run, an ordinary gap between runs. This is the whole
        // point of grouping: a burst of five messages reads as one turn.
        isRunContinuation ? "mt-[3px]" : "mt-2",
        hasReactions && "mb-4",
        selectionMode && "cursor-pointer",
      )}
      onClick={handleClick}
    >
      {/* Selection checkbox - shown on left for all messages in selection mode */}
      {selectionMode && (
        <SelectionCheckbox isOwn={isOwn} isSelected={isSelected} />
      )}

      {isGroup && !isOwn && (
        <GroupParticipantAvatar
          message={message}
          hidden={!isRunEnd}
          participants={mentionParticipants}
          selectionMode={selectionMode}
        />
      )}

      <div
        ref={bubbleRef}
        className={cn(
          "relative max-w-[85%] px-2.5 py-[7px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] transition-[background-color,box-shadow] duration-300 sm:max-w-[75%] md:max-w-[70%] md:px-3 md:py-2",
          bubbleRadiusClass(isOwn, groupPosition),
          isOwn ? OWN_BUBBLE_CLASS : INCOMING_BUBBLE_CLASS,
          isHighlighted &&
            "ring-2 ring-yellow-400 ring-offset-2 dark:ring-offset-dark-primary",
          isSelected &&
            "ring-2 ring-whatsapp-teal-green ring-offset-1 dark:ring-offset-dark-primary",
          "touch-manipulation",
        )}
        onContextMenu={selectionMode ? undefined : handleContextMenu}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        data-message-id={message.id}
      >
        {/* Identity is explicit on both sides of a shared team conversation,
            but only once per run - repeating it on every bubble is what made
            a burst of replies unreadable. */}
        {isOwn && isRunStart && (
          <TeamSenderLabel
            message={message}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
          />
        )}
        {isGroup && !isOwn && isRunStart && !message.isDeleted && (
          <GroupParticipantLabel
            message={message}
            participants={mentionParticipants}
            selectionMode={selectionMode}
          />
        )}

        {/* Forwarded indicator */}
        {message.isForwarded && !message.isDeleted && (
          <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
            <ForwardIcon className="h-3 w-3" />
            <span>{t("chat.forwarded")}</span>
          </div>
        )}

        {/* Reply preview */}
        {shouldShowReplyPreview(message) && (
          <ReplyPreview
            replyToMessage={message.replyToMessage}
            replyToMessageId={message.replyToMessageId}
            isOwn={isOwn}
            currentUserId={currentUserId}
            mentionParticipants={mentionParticipants}
            onNavigateToMessage={onNavigateToMessage}
          />
        )}

        {/* Message content. Plain text is rendered here rather than through
            MessageContent so the timestamp can be handed to the paragraph as
            a trailing float and share its last line - see LinkifiedText. */}
        {hasInlineMeta ? (
          <LinkifiedText
            text={message.content}
            isOwn={isOwn}
            mentionParticipants={mentionParticipants}
            className="text-[15px] leading-[1.35rem]"
            trailing={message.status === "failed" && isOwn ? undefined : meta}
          />
        ) : (
          <MessageContent
            message={message}
            albumMessages={albumMessages}
            albumExpectedCount={albumExpectedCount}
            isOwn={isOwn}
            mentionParticipants={mentionParticipants}
            enableMediaPreview={!selectionMode}
          />
        )}

        {/* Error banner for failed messages */}
        {message.status === "failed" && isOwn && (
          <FailedMessageBanner
            message={message}
            isOwn={isOwn}
            isRetrying={isRetrying}
            onRetry={onRetry}
          />
        )}

        {/* A failed send pushes its meta back below the retry banner, which
            would otherwise be separated from the status it explains. */}
        {(!hasInlineMeta || (message.status === "failed" && isOwn)) && (
          <MessageMeta message={message} isOwn={isOwn} variant="block" />
        )}

        {/* Reaction display */}
        {hasReactions && (
          <MessageReactions
            reactions={message.reactions!}
            isOwn={isOwn}
            onRemoveOwnReaction={() => onReact?.(message, "")}
          />
        )}

        {/* Context menu - rendered via portal to escape overflow:hidden containers */}
        {showContextMenu &&
          createPortal(
            <MessageContextMenu
              ref={contextMenuRef}
              message={message}
              position={contextMenuPosition}
              onReply={onReply}
              onForward={onForward}
              onDelete={onDelete}
              onStar={onStar}
              onReact={handleReactionClick}
              onClose={() => setShowContextMenu(false)}
            />,
            document.body,
          )}

        {/* Reaction picker - lazy loaded and rendered via portal to escape overflow:hidden containers */}
        {showReactionPicker &&
          createPortal(
            <Suspense
              fallback={
                <ReactionPickerSkeleton position={reactionPickerPosition} />
              }
            >
              <EmojiReactionPicker
                position={reactionPickerPosition}
                onSelectReaction={handleSelectReaction}
                onClose={() => setShowReactionPicker(false)}
              />
            </Suspense>,
            document.body,
          )}
      </div>

      {!isGroup && isOwn && (
        <TeamSenderAvatar
          message={message}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserAvatarUrl={currentUserAvatarUrl}
          currentUserGravatarUrl={currentUserGravatarUrl}
          teammateIdentity={
            message.sentByUserId
              ? teammateIdentities.get(message.sentByUserId)
              : undefined
          }
          hidden={!isRunEnd}
        />
      )}
    </div>
  );
});

/**
 * Timestamp, delivery status and star.
 *
 * `inline` floats it to the right of the paragraph's last line, so short
 * messages stay one line tall instead of paying a whole row for a five
 * character time. `block` is the fallback for media and deleted messages,
 * whose content is not an inline formatting context.
 */
function MessageMeta({
  message,
  isOwn,
  variant,
}: {
  message: Message;
  isOwn: boolean;
  variant: "inline" | "block";
}) {
  return (
    <span
      className={cn(
        "items-center gap-1 whitespace-nowrap text-[11px] leading-4",
        isOwn
          ? "text-current opacity-60"
          : "text-[#667781] dark:text-dark-text-secondary",
        variant === "inline"
          ? // `select-none` keeps the timestamp out of a copied message.
            "float-right ml-2 mt-1 inline-flex translate-y-0.5 select-none"
          : "mt-1 flex justify-end",
      )}
    >
      <span className="tabular-nums">
        {formatMessageTime(message.createdAt)}
      </span>
      <MessageStatusIcon message={message} isOwn={isOwn} />
      {message.isStarred && !message.isDeleted && (
        <StarFilledIcon className="h-3 w-3 text-yellow-500 dark:text-yellow-400" />
      )}
    </span>
  );
}

/**
 * Skeleton loading state for the reaction picker
 * Shows a placeholder while the reaction picker chunk loads
 */
function ReactionPickerSkeleton({
  position,
}: {
  position: { x: number; y: number };
}) {
  return (
    <div
      className="fixed z-50 bg-white dark:bg-dark-elevated rounded-full shadow-lg px-3 py-2 flex items-center gap-2"
      style={{ left: position.x, top: position.y }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="w-8 h-8 bg-gray-100 dark:bg-dark-tertiary rounded-full animate-pulse"
        />
      ))}
    </div>
  );
}

/**
 * Selection checkbox component
 */
function SelectionCheckbox({
  isOwn,
  isSelected,
}: {
  isOwn: boolean;
  isSelected: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center ${isOwn ? "order-2 ml-2" : "mr-2"}`}
      role="checkbox"
      aria-checked={isSelected}
      aria-label={
        isSelected
          ? t(
              "chat.messageSelected",
              t("chat.messageSelected", "Message selected"),
            )
          : t("chat.selectMessage", "Select message")
      }
    >
      <div
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
          isSelected
            ? "bg-whatsapp-teal-green border-whatsapp-teal-green"
            : "border-gray-400 dark:border-dark-text-tertiary bg-transparent"
        }`}
      >
        {isSelected && (
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

/**
 * Reply preview component
 */
function ReplyPreview({
  replyToMessage,
  replyToMessageId,
  isOwn,
  currentUserId,
  mentionParticipants,
  onNavigateToMessage,
}: {
  replyToMessage: Message["replyToMessage"];
  replyToMessageId: Message["replyToMessageId"];
  isOwn: boolean;
  currentUserId: string;
  mentionParticipants: MentionParticipant[];
  onNavigateToMessage?: (target: MessageNavigationTarget) => void;
}) {
  const { t } = useTranslation();

  const replySender = !replyToMessage
    ? t("chat.reply")
    : replyToMessage.senderType === "user"
      ? replyToMessage.sentByUserId === currentUserId
        ? t("chat.you")
        : replyToMessage.sentByUserName || "Team member"
      : formatPhoneLikeText(replyToMessage.senderName) ||
        t("chat.unknownContact");
  const replyContent = !replyToMessage
    ? t("chat.quotedMessageUnavailable")
    : replyToMessage.isDeleted
      ? t("chat.messageDeleted")
      : replyToMessage.content;

  const navigationTarget = getReplyNavigationTarget(
    replyToMessage,
    replyToMessageId,
  );
  const canNavigate = Boolean(navigationTarget);
  const Component = canNavigate ? "button" : "div";

  return (
    <Component
      {...(canNavigate
        ? {
            type: "button" as const,
            onClick: (event: React.MouseEvent) => {
              event.stopPropagation();
              if (navigationTarget) {
                onNavigateToMessage?.(navigationTarget);
              }
            },
            "aria-label": `${t("chat.reply")}: ${replySender}`,
          }
        : {})}
      className={`mb-1.5 w-full overflow-hidden rounded-lg border-l-[3px] p-2 text-left ${
        isOwn
          ? "border-[#0e7a52] bg-black/[0.06] dark:border-[#68e0b6] dark:bg-black/20"
          : "border-whatsapp-green bg-black/[0.045] dark:bg-white/[0.06]"
      } ${
        canNavigate
          ? "cursor-pointer transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green dark:hover:bg-black/30"
          : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <ReplyIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 opacity-60" />
        <div className="flex-1 min-w-0">
          <p
            className={`text-xs font-semibold mb-0.5 ${
              isOwn
                ? "text-current opacity-90"
                : "text-gray-900 dark:text-dark-text-primary"
            }`}
          >
            {replySender}
          </p>
          <LinkifiedText
            text={replyContent}
            isOwn={isOwn}
            mentionParticipants={mentionParticipants}
            enableInteractions={false}
            className={`line-clamp-2 text-xs ${
              isOwn
                ? "text-current opacity-70"
                : "text-gray-700 dark:text-dark-text-secondary"
            }`}
          />
        </div>
      </div>
    </Component>
  );
}

/**
 * Failed message error banner with retry button
 */
function FailedMessageBanner({
  message,
  isOwn,
  isRetrying,
  onRetry,
}: {
  message: Message;
  isOwn: boolean;
  isRetrying: boolean;
  onRetry?: (messageId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`mt-2 flex items-center justify-between gap-2 text-xs px-2 py-1 rounded ${
        isOwn
          ? "bg-red-500/15 text-red-800 dark:bg-red-500/20 dark:text-red-100"
          : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100"
      }`}
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-3 w-3 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>
          {getErrorMessage(
            t,
            message.metadata?.error,
            message.metadata?.errorMessage,
          )}
        </span>
      </div>
      {onRetry && (
        <button
          onClick={() => onRetry(message.id)}
          disabled={isRetrying}
          className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors ${
            isOwn
              ? "bg-black/10 text-current hover:bg-black/15 dark:bg-white/20 dark:hover:bg-white/30"
              : "bg-red-200 text-red-800 hover:bg-red-300 dark:bg-white/15 dark:text-red-100 dark:hover:bg-white/25"
          } ${isRetrying ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={t("chat.retrySendAria", "Retry sending this message")}
        >
          {isRetrying ? (
            <>
              <svg
                className="animate-spin h-3 w-3"
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
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>{t("chat.statusLabels.sendingEllipsis", "Sending…")}</span>
            </>
          ) : (
            <>
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>{t("common.retry", "Retry")}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

function TeamSenderLabel({
  message,
  currentUserId,
  currentUserName,
}: {
  message: Message;
  currentUserId: string;
  currentUserName?: string;
}) {
  const { t } = useTranslation();

  const wasSentByCurrentUser = message.sentByUserId === currentUserId;
  const wasSentFromTeamInbox = Boolean(message.sentByUserId);
  const label =
    message.sentByUserName ||
    (wasSentByCurrentUser ? currentUserName : undefined) ||
    (wasSentFromTeamInbox
      ? t("chat.teamMember", "Team member")
      : t("chat.linkedPhone", "Linked phone"));
  const color = getSenderColor(
    message.sentByUserId || "linked-phone",
    label,
    teamSenderColors,
  );

  return (
    <div
      className={`mb-1 truncate text-[13px] font-semibold leading-4 ${color}`}
      title={
        wasSentFromTeamInbox
          ? t("chat.teamInboxSender", {
              defaultValue: "{{label}} · Team inbox",
              label,
            })
          : t(
              "chat.linkedPhoneSender",
              "Sent directly from the linked WhatsApp phone",
            )
      }
    >
      {label}
    </div>
  );
}

/**
 * Attribution colours for outgoing bubbles. Each entry carries both themes
 * because the outgoing fill flips from pale green to deep teal - a pastel
 * that reads on the dark fill disappears on the light one.
 */
const teamSenderColors = [
  "text-[#0b6b7a] dark:text-[#a5e8f7]",
  "text-[#8a5a00] dark:text-[#ffe08a]",
  "text-[#6b3fa0] dark:text-[#e0cbff]",
  "text-[#a63a5e] dark:text-[#ffc7da]",
  "text-[#9a5215] dark:text-[#ffd7ab]",
  "text-[#0e7a52] dark:text-[#b6f0d3]",
  "text-[#3f56b0] dark:text-[#c9d6ff]",
] as const;

function getTeamSenderIdentity(
  t: TFunction,
  message: Message,
  currentUserId: string,
  currentUserName?: string,
  currentUserAvatarUrl?: string,
  currentUserGravatarUrl?: string,
  teammateIdentity?: TeamMemberIdentity,
) {
  const wasSentByCurrentUser = message.sentByUserId === currentUserId;
  const wasSentFromTeamInbox = Boolean(message.sentByUserId);
  return {
    label:
      teammateIdentity?.name ||
      message.sentByUserName ||
      (wasSentByCurrentUser ? currentUserName : undefined) ||
      (wasSentFromTeamInbox
        ? t("chat.teamMember", "Team member")
        : t("chat.linkedPhone", "Linked phone")),
    identity: message.sentByUserId || message.senderId,
    avatarUrl:
      teammateIdentity?.avatarUrl ||
      message.sentByUserAvatarUrl ||
      (wasSentByCurrentUser ? currentUserAvatarUrl : undefined),
    gravatarUrl:
      teammateIdentity?.gravatarUrl ||
      message.sentByUserGravatarUrl ||
      (wasSentByCurrentUser ? currentUserGravatarUrl : undefined),
  };
}

function TeamSenderAvatar({
  message,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  currentUserGravatarUrl,
  teammateIdentity,
  hidden = false,
}: {
  message: Message;
  currentUserId: string;
  currentUserName?: string;
  currentUserAvatarUrl?: string;
  currentUserGravatarUrl?: string;
  teammateIdentity?: TeamMemberIdentity;
  hidden?: boolean;
}) {
  const { t } = useTranslation();

  const { label, identity, avatarUrl, gravatarUrl } = getTeamSenderIdentity(
    t,
    message,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    currentUserGravatarUrl,
    teammateIdentity,
  );
  return (
    <SenderAvatar
      label={label}
      identity={identity}
      avatarUrl={avatarUrl}
      fallbackAvatarUrl={gravatarUrl}
      side="right"
      fallbackKind={message.sentByUserId ? "identity" : "linked-phone"}
      hidden={hidden}
    />
  );
}

const participantColors = [
  "text-emerald-700 dark:text-emerald-400",
  "text-cyan-700 dark:text-cyan-400",
  "text-blue-700 dark:text-blue-400",
  "text-violet-700 dark:text-violet-400",
  "text-fuchsia-700 dark:text-fuchsia-400",
  "text-rose-700 dark:text-rose-400",
  "text-orange-700 dark:text-orange-400",
] as const;

function getSenderColor(
  identity: string | null | undefined,
  label: string,
  colors: readonly string[],
): string {
  let hash = 0;
  for (const character of identity || label) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function getParticipantLabel(t: TFunction, message: Message): string {
  const senderIdentity = message.senderJid || message.senderId;
  const senderName = message.senderName?.trim();
  if (senderName) return formatPhoneLikeText(senderName);
  if (!senderIdentity || senderIdentity.endsWith("@g.us")) {
    return t("chat.unknownParticipant", "Unknown participant");
  }
  const identifier = senderIdentity.split("@")[0]?.split(":")[0] || "";
  return /^\d+$/.test(identifier) ? `+${identifier}` : identifier;
}

function GroupParticipantAvatar({
  message,
  hidden = false,
  participants = [],
  selectionMode = false,
}: {
  message: Message;
  hidden?: boolean;
  participants?: ParticipantIdentity[];
  selectionMode?: boolean;
}) {
  const { t } = useTranslation();
  const { onOpenParticipantProfile } = useMessageActions();

  const label = getParticipantLabel(t, message);
  const contactId = resolveParticipantContactId(
    message.senderJid || message.senderId,
    participants,
  );

  const avatar = (
    <SenderAvatar
      label={label}
      identity={message.senderJid || message.senderId}
      avatarUrl={message.senderAvatarUrl}
      side="left"
      hidden={hidden}
    />
  );

  // The gutter placeholder that keeps a run aligned carries no identity, so it
  // must never become a control. While messages are being selected the whole
  // row is the selection target, so the identity stops being one.
  if (hidden || selectionMode || !contactId || !onOpenParticipantProfile) {
    return avatar;
  }

  return (
    <button
      type="button"
      // Selection mode and the long-press menu both live on the row that wraps
      // this avatar, so the click must stop here.
      onClick={(event) => {
        event.stopPropagation();
        onOpenParticipantProfile(contactId);
      }}
      aria-label={t("chat.openParticipantProfile", {
        defaultValue: "Open {{name}}'s contact info",
        name: label,
      })}
      className="flex shrink-0 self-end rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/50"
    >
      {avatar}
    </button>
  );
}

function SenderAvatar({
  label,
  identity,
  avatarUrl,
  fallbackAvatarUrl,
  side,
  fallbackKind = "identity",
  hidden = false,
}: {
  label: string;
  identity?: string | null;
  avatarUrl?: string | null;
  fallbackAvatarUrl?: string | null;
  side: "left" | "right";
  fallbackKind?: "identity" | "linked-phone";
  /**
   * Mid-run bubbles keep the gutter but drop the picture, so a run stays
   * aligned under the one avatar its last bubble carries.
   */
  hidden?: boolean;
}) {
  const [failedAvatarUrls, setFailedAvatarUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const activeAvatarUrl =
    avatarUrl && !failedAvatarUrls.has(avatarUrl)
      ? avatarUrl
      : fallbackAvatarUrl && !failedAvatarUrls.has(fallbackAvatarUrl)
        ? fallbackAvatarUrl
        : null;
  if (hidden) {
    return (
      <div
        className={cn("size-8 shrink-0", side === "left" ? "mr-2" : "ml-2")}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={`${side === "left" ? "mr-2" : "ml-2"} mb-0.5 flex h-8 w-8 shrink-0 self-end items-center justify-center overflow-hidden rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10`}
      title={label}
      aria-label={`${label}'s profile picture`}
    >
      {activeAvatarUrl ? (
        <img
          src={activeAvatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() =>
            setFailedAvatarUrls((failed) => {
              const next = new Set(failed);
              next.add(activeAvatarUrl);
              return next;
            })
          }
        />
      ) : fallbackKind === "linked-phone" ? (
        <span
          className="flex h-full w-full items-center justify-center bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          aria-hidden="true"
        >
          <Smartphone className="h-[55%] w-[55%]" strokeWidth={1.9} />
        </span>
      ) : (
        <IdentityAvatarFallback
          displayName={label}
          identity={identity}
          className="text-[11px]"
        />
      )}
    </div>
  );
}

function GroupParticipantLabel({
  message,
  participants = [],
  selectionMode = false,
}: {
  message: Message;
  participants?: ParticipantIdentity[];
  selectionMode?: boolean;
}) {
  const { t } = useTranslation();
  const { onOpenParticipantProfile } = useMessageActions();

  const senderIdentity = message.senderJid || message.senderId;
  const label = getParticipantLabel(t, message);
  const color = getSenderColor(senderIdentity, label, participantColors);
  const contactId = resolveParticipantContactId(senderIdentity, participants);

  // A sender the workspace holds no contact for stays plain text: a control
  // that opened an empty profile would be worse than no control. The same
  // applies while selecting, where the row itself is the target.
  if (selectionMode || !contactId || !onOpenParticipantProfile) {
    return (
      <div
        className={`mb-1 truncate text-[13px] font-semibold leading-4 ${color}`}
        title={senderIdentity || label}
      >
        {label}
      </div>
    );
  }

  return (
    <button
      type="button"
      // The bubble itself handles click for selection mode and long-press for
      // the context menu; this control must not hand it either.
      onClick={(event) => {
        event.stopPropagation();
        onOpenParticipantProfile(contactId);
      }}
      aria-label={t("chat.openParticipantProfile", {
        defaultValue: "Open {{name}}'s contact info",
        name: label,
      })}
      title={senderIdentity || label}
      className={`mb-1 block max-w-full truncate rounded text-left text-[13px] font-semibold leading-4 underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/50 ${color}`}
    >
      {label}
    </button>
  );
}

export default MessageBubble;
