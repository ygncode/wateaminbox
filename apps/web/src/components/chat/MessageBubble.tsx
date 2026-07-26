import type { Message } from "@wateaminbox/shared";
import { formatMessageTime } from "@wateaminbox/shared";
import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { formatPhoneLikeText } from "@/lib/utils";
import { useMessageActions } from "../../contexts";
import { useClickOutside } from "../../hooks/ui";
import { MessageContent } from "./MessageContent";

// Lazy load emoji reaction picker - only loaded when user opens it
const EmojiReactionPicker = lazy(() => import("./EmojiReactionPicker"));

import { MessageContextMenu } from "./MessageContextMenu";
import { ForwardIcon, ReplyIcon, StarFilledIcon } from "./MessageIcons";
import { MessageReactions } from "./MessageReactions";
import { getErrorMessage, MessageStatusIcon } from "./MessageStatusIcon";

export function shouldShowReplyPreview(
  message: Pick<Message, "replyToMessageId" | "isDeleted">,
): boolean {
  return Boolean(message.replyToMessageId && !message.isDeleted);
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  /** Whether the active conversation is a WhatsApp group. */
  isGroup?: boolean;
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
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  isGroup = false,
  onRetry,
  isHighlighted = false,
  isRetrying = false,
  selectionMode = false,
  isSelected = false,
  onSelectionToggle,
}: MessageBubbleProps) {
  // Get message actions from context (eliminates prop drilling)
  const { onReply, onForward, onDelete, onStar, onReact } = useMessageActions();
  const { t } = useTranslation();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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
  }, [isOwn]);

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

  return (
    <div
      className={`flex ${isOwn ? "justify-end" : "justify-start"} ${hasReactions ? "mb-5" : "mb-1"} group ${
        selectionMode ? "cursor-pointer" : ""
      }`}
      onClick={handleClick}
    >
      {/* Selection checkbox - shown on left for all messages in selection mode */}
      {selectionMode && (
        <SelectionCheckbox isOwn={isOwn} isSelected={isSelected} />
      )}

      {isGroup && !isOwn && <GroupParticipantAvatar message={message} />}

      <div
        ref={bubbleRef}
        className={`relative max-w-[70%] px-3 py-2 rounded-lg shadow-sm transition-[background-color,box-shadow] duration-300 ${
          isOwn
            ? "bg-whatsapp-green text-white rounded-br-none"
            : "bg-white dark:bg-dark-elevated text-gray-900 dark:text-dark-text-primary rounded-bl-none"
        } ${isHighlighted ? "ring-2 ring-yellow-400 ring-offset-2 dark:ring-offset-dark-primary bg-yellow-50/20 dark:bg-yellow-900/20" : ""} ${
          isSelected
            ? "ring-2 ring-whatsapp-teal-green ring-offset-1 dark:ring-offset-dark-primary"
            : ""
        }`}
        onContextMenu={selectionMode ? undefined : handleContextMenu}
        data-message-id={message.id}
      >
        {/* Group participant identity */}
        {isGroup && !isOwn && !message.isDeleted && (
          <GroupParticipantLabel message={message} />
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
          <ReplyPreview replyToMessage={message.replyToMessage} isOwn={isOwn} />
        )}

        {/* Message content */}
        <MessageContent message={message} isOwn={isOwn} />

        {/* Error banner for failed messages */}
        {message.status === "failed" && isOwn && (
          <FailedMessageBanner
            message={message}
            isOwn={isOwn}
            isRetrying={isRetrying}
            onRetry={onRetry}
          />
        )}

        {/* Timestamp and status */}
        <div
          className={`flex items-center justify-end gap-1 mt-1 text-xs ${
            isOwn
              ? "text-white/70"
              : "text-gray-500 dark:text-dark-text-secondary"
          }`}
        >
          <span>{formatMessageTime(message.createdAt)}</span>
          <MessageStatusIcon message={message} isOwn={isOwn} />
          {message.isStarred && !message.isDeleted && (
            <StarFilledIcon className="h-3 w-3 text-yellow-400" />
          )}
        </div>

        {/* Reaction display */}
        {hasReactions && (
          <MessageReactions reactions={message.reactions!} isOwn={isOwn} />
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
    </div>
  );
});

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
  return (
    <div
      className={`flex items-center ${isOwn ? "order-2 ml-2" : "mr-2"}`}
      role="checkbox"
      aria-checked={isSelected}
      aria-label={isSelected ? "Message selected" : "Select message"}
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
  isOwn,
}: {
  replyToMessage: Message["replyToMessage"];
  isOwn: boolean;
}) {
  const { t } = useTranslation();

  const replySender = !replyToMessage
    ? t("chat.reply")
    : replyToMessage.senderType === "user"
      ? t("chat.you")
      : formatPhoneLikeText(replyToMessage.senderName) ||
        t("chat.unknownContact");
  const replyContent = !replyToMessage
    ? t("chat.quotedMessageUnavailable")
    : replyToMessage.isDeleted
      ? t("chat.messageDeleted")
      : replyToMessage.content;

  return (
    <div
      className={`mb-2 p-2.5 rounded-lg border-l-4 ${
        isOwn
          ? "bg-whatsapp-dark-green/30 border-white/50"
          : "bg-gray-100 dark:bg-dark-tertiary border-whatsapp-green"
      }`}
    >
      <div className="flex items-start gap-2">
        <ReplyIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 opacity-60" />
        <div className="flex-1 min-w-0">
          <p
            className={`text-xs font-semibold mb-0.5 ${
              isOwn
                ? "text-white/90"
                : "text-gray-900 dark:text-dark-text-primary"
            }`}
          >
            {replySender}
          </p>
          <p
            className={`text-xs line-clamp-2 ${
              isOwn
                ? "text-white/80"
                : "text-gray-700 dark:text-dark-text-secondary"
            }`}
          >
            {replyContent}
          </p>
        </div>
      </div>
    </div>
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
  return (
    <div
      className={`mt-2 flex items-center justify-between gap-2 text-xs px-2 py-1 rounded ${
        isOwn ? "bg-red-500/20 text-red-100" : "bg-red-100 text-red-700"
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
              ? "bg-white/20 hover:bg-white/30 text-white"
              : "bg-red-200 hover:bg-red-300 text-red-800"
          } ${isRetrying ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label="Retry sending this message"
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
              <span>Sending…</span>
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
              <span>Retry</span>
            </>
          )}
        </button>
      )}
    </div>
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

function getParticipantLabel(message: Message): string {
  const senderIdentity = message.senderJid || message.senderId;
  const senderName = message.senderName?.trim();
  if (senderName) return formatPhoneLikeText(senderName);
  if (!senderIdentity || senderIdentity.endsWith("@g.us")) {
    return "Unknown participant";
  }
  const identifier = senderIdentity.split("@")[0]?.split(":")[0] || "";
  return /^\d+$/.test(identifier) ? `+${identifier}` : identifier;
}

function GroupParticipantAvatar({ message }: { message: Message }) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = getParticipantLabel(message);
  return (
    <div
      className="mr-2 mb-1 flex h-8 w-8 shrink-0 self-end items-center justify-center overflow-hidden rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10"
      title={label}
      aria-label={`${label}'s profile picture`}
    >
      {message.senderAvatarUrl && !imageFailed ? (
        <img
          src={message.senderAvatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <IdentityAvatarFallback
          displayName={label}
          identity={message.senderJid || message.senderId}
          className="text-[11px]"
        />
      )}
    </div>
  );
}

function GroupParticipantLabel({ message }: { message: Message }) {
  const senderIdentity = message.senderJid || message.senderId;
  const label = getParticipantLabel(message);

  let hash = 0;
  for (const character of senderIdentity || label) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  const color = participantColors[Math.abs(hash) % participantColors.length];

  return (
    <div
      className={`mb-1 truncate text-[13px] font-semibold leading-4 ${color}`}
      title={senderIdentity || label}
    >
      {label}
    </div>
  );
}

export default MessageBubble;
