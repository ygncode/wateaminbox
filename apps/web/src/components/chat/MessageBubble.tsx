import type { Message } from "@whatsapp-web/shared";
import { formatMessageTime } from "@whatsapp-web/shared";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmojiReactionPicker } from "./EmojiReactionPicker";
import { MessageContent } from "./MessageContent";
import { MessageContextMenu } from "./MessageContextMenu";
import { ForwardIcon, ReplyIcon, StarFilledIcon } from "./MessageIcons";
import { MessageReactions } from "./MessageReactions";
import { MessageStatusIcon, getErrorMessage } from "./MessageStatusIcon";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onReply?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onStar?: (message: Message) => void;
  onReact?: (message: Message, emoji: string) => void;
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
  onReply,
  onForward,
  onDelete,
  onStar,
  onReact,
  onRetry,
  isHighlighted = false,
  isRetrying = false,
  selectionMode = false,
  isSelected = false,
  onSelectionToggle,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [reactionPickerPosition, setReactionPickerPosition] = useState({
    x: 0,
    y: 0,
  });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (message.isDeleted) return;

      const rect = bubbleRef.current?.getBoundingClientRect();
      if (rect) {
        setContextMenuPosition({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
      setShowContextMenu(true);
    },
    [message.isDeleted],
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target as Node)
      ) {
        setShowContextMenu(false);
      }
    }

    if (showContextMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showContextMenu]);

  const handleReactionClick = useCallback(() => {
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) {
      setReactionPickerPosition({
        x: isOwn ? -20 : rect.width - 20,
        y: -50,
      });
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

      <div
        ref={bubbleRef}
        className={`relative max-w-[70%] px-3 py-2 rounded-lg shadow-sm transition-all duration-300 ${
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
        {/* Forwarded indicator */}
        {message.isForwarded && !message.isDeleted && (
          <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
            <ForwardIcon className="h-3 w-3" />
            <span>{t("chat.forwarded")}</span>
          </div>
        )}

        {/* Reply preview */}
        {message.replyToMessage && !message.isDeleted && (
          <ReplyPreview
            replyToMessage={message.replyToMessage}
            isOwn={isOwn}
          />
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

        {/* Context menu */}
        {showContextMenu && (
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
          />
        )}

        {/* Reaction picker */}
        {showReactionPicker && (
          <EmojiReactionPicker
            position={reactionPickerPosition}
            onSelectReaction={handleSelectReaction}
            onClose={() => setShowReactionPicker(false)}
          />
        )}
      </div>
    </div>
  );
});

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
    <div className={`flex items-center ${isOwn ? "order-2 ml-2" : "mr-2"}`}>
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

  if (!replyToMessage) return null;

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
            {replyToMessage.senderType === "user" ? "You" : "Contact"}
          </p>
          <p
            className={`text-xs line-clamp-2 ${
              isOwn
                ? "text-white/80"
                : "text-gray-700 dark:text-dark-text-secondary"
            }`}
          >
            {replyToMessage.isDeleted
              ? t("chat.messageDeleted")
              : replyToMessage.content}
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
          title="Retry sending this message"
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
              <span>Sending...</span>
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

export default MessageBubble;
