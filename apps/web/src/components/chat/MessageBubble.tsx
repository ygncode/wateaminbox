import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import type { Message, MessageType } from "@whatsapp-web/shared";

// Error code to human-readable message mapping
const ERROR_MESSAGES: Record<string, string> = {
  delivery_timeout: "Message delivery timed out",
  network_error: "Network error occurred",
  rate_limit: "Too many messages. Please try again later",
  unknown: "Failed to send message",
};

function getErrorMessage(error?: string, customErrorMessage?: string): string {
  return customErrorMessage || ERROR_MESSAGES[error || ""] || ERROR_MESSAGES.unknown;
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onReply?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onStar?: (message: Message) => void;
  onRetry?: (messageId: string) => void;
  /** Highlight this message (e.g., from search) */
  isHighlighted?: boolean;
  isRetrying?: boolean;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  onReply,
  onForward,
  onDelete,
  onStar,
  onRetry,
  isHighlighted = false,
  isRetrying = false,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
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

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const renderStatusIcon = () => {
    if (!isOwn) return null;

    switch (message.status) {
      case "pending":
        return (
          <svg
            className="h-4 w-4 text-gray-400"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" />
          </svg>
        );
      case "sent":
        return (
          <svg
            className="h-4 w-4 text-gray-400"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5.5 11.5L2 8l1-1 2.5 2.5L11 4l1 1-6.5 6.5z" />
          </svg>
        );
      case "delivered":
        return (
          <svg
            className="h-4 w-4 text-gray-400"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5.5 11.5L2 8l1-1 2.5 2.5L11 4l1 1-6.5 6.5z" />
            <path d="M8.5 11.5L5 8l1-1 2.5 2.5L14 4l1 1-6.5 6.5z" />
          </svg>
        );
      case "read":
        return (
          <svg
            className="h-4 w-4 text-blue-500"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5.5 11.5L2 8l1-1 2.5 2.5L11 4l1 1-6.5 6.5z" />
            <path d="M8.5 11.5L5 8l1-1 2.5 2.5L14 4l1 1-6.5 6.5z" />
          </svg>
        );
      case "failed":
        const errorMsg = getErrorMessage(message.metadata?.error, message.metadata?.errorMessage);
        return (
          <div className="group/tooltip relative flex items-center">
            <svg
              className="h-4 w-4 text-red-500"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" />
              <path d="M8 4v5M8 11v1" />
            </svg>
            {/* Tooltip for failed messages */}
            <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-10">
              {errorMsg}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderMessageContent = () => {
    if (message.isDeleted) {
      return (
        <span className="italic text-gray-500 dark:text-gray-400">{t('chat.messageDeleted')}</span>
      );
    }

    const contentRenderer: Record<MessageType, () => React.ReactNode> = {
      text: () => (
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      ),
      image: () => (
        <div className="max-w-xs">
          <img
            src={message.metadata?.mediaUrl}
            alt={message.metadata?.caption || "Image"}
            className="rounded-lg max-w-full h-auto cursor-pointer"
            loading="lazy"
          />
          {message.metadata?.caption && (
            <p className="mt-1 whitespace-pre-wrap break-words">
              {message.metadata.caption}
            </p>
          )}
        </div>
      ),
      video: () => (
        <div className="max-w-xs">
          <video
            src={message.metadata?.mediaUrl}
            poster={message.metadata?.thumbnailUrl}
            controls
            className="rounded-lg max-w-full h-auto"
          />
          {message.metadata?.caption && (
            <p className="mt-1 whitespace-pre-wrap break-words">
              {message.metadata.caption}
            </p>
          )}
        </div>
      ),
      audio: () => (
        <div className="flex items-center gap-2 min-w-[200px]">
          <audio src={message.metadata?.mediaUrl} controls className="w-full" />
          {message.metadata?.duration && (
            <span className="text-xs text-gray-500">
              {Math.floor(message.metadata.duration / 60)}:
              {String(message.metadata.duration % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      ),
      document: () => (
        <a
          href={message.metadata?.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <div className="flex-shrink-0">
            <svg
              className="h-10 w-10 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {message.metadata?.fileName || "Document"}
            </p>
            {message.metadata?.fileSize && (
              <p className="text-xs text-gray-500">
                {formatFileSize(message.metadata.fileSize)}
              </p>
            )}
          </div>
        </a>
      ),
      location: () => (
        <div className="max-w-xs">
          <div className="bg-gray-200 rounded-lg h-32 flex items-center justify-center">
            <svg
              className="h-8 w-8 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <p className="mt-1 text-sm">
            {message.metadata?.latitude}, {message.metadata?.longitude}
          </p>
        </div>
      ),
      template: () => (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Template Message</p>
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      ),
    };

    return (
      contentRenderer[message.messageType]?.() || (
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      )
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const contextMenuItems = [
    { label: "Reply", icon: ReplyIcon, action: () => onReply?.(message) },
    { label: "Forward", icon: ForwardIcon, action: () => onForward?.(message) },
    {
      label: message.isStarred ? "Unstar" : "Star",
      icon: StarIcon,
      action: () => onStar?.(message),
    },
    { label: "Delete", icon: DeleteIcon, action: () => onDelete?.(message) },
  ];

  return (
    <div
      className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-1 group`}
    >
      <div
        ref={bubbleRef}
        className={`relative max-w-[70%] px-3 py-2 rounded-lg shadow-sm transition-all duration-300 ${
          isOwn
            ? "bg-whatsapp-green text-white rounded-br-none"
            : "bg-white text-gray-900 rounded-bl-none"
        } ${isHighlighted ? "ring-2 ring-yellow-400 ring-offset-2 bg-yellow-50/20" : ""}`}
        onContextMenu={handleContextMenu}
        data-message-id={message.id}
      >
        {/* Forwarded indicator */}
        {message.isForwarded && !message.isDeleted && (
          <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
            <ForwardIcon className="h-3 w-3" />
            <span>{t('chat.forwarded')}</span>
          </div>
        )}

        {/* Reply preview */}
        {message.replyToMessage && !message.isDeleted && (
          <div
            className={`mb-2 p-2 rounded border-l-4 ${
              isOwn
                ? "bg-whatsapp-dark-green/30 border-white/50"
                : "bg-gray-100 border-whatsapp-green"
            }`}
          >
            <p className="text-xs font-medium truncate">
              {message.replyToMessage.senderType === "user" ? "You" : "Contact"}
            </p>
            <p className="text-xs opacity-80 truncate">
              {message.replyToMessage.isDeleted
                ? t('chat.messageDeleted')
                : message.replyToMessage.content}
            </p>
          </div>
        )}

        {/* Message content */}
        {renderMessageContent()}

        {/* Error banner for failed messages */}
        {message.status === "failed" && isOwn && (
          <div
            className={`mt-2 flex items-center justify-between gap-2 text-xs px-2 py-1 rounded ${
              isOwn
                ? "bg-red-500/20 text-red-100"
                : "bg-red-100 text-red-700"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{getErrorMessage(message.metadata?.error, message.metadata?.errorMessage)}</span>
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
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Retry</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Timestamp and status */}
        <div
          className={`flex items-center justify-end gap-1 mt-1 text-xs ${
            isOwn ? "text-white/70" : "text-gray-500"
          }`}
        >
          <span>{formatTime(message.createdAt)}</span>
          {renderStatusIcon()}
          {message.isStarred && !message.isDeleted && (
            <StarFilledIcon className="h-3 w-3 text-yellow-400" />
          )}
        </div>

        {/* Context menu */}
        {showContextMenu && (
          <div
            ref={contextMenuRef}
            className="absolute z-50 bg-white rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
            }}
          >
            {contextMenuItems.map((item) => (
              <button
                key={item.label}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  item.action();
                  setShowContextMenu(false);
                }}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// Icon components
function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
      />
    </svg>
  );
}

function ForwardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
      />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  );
}

function StarFilledIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

function DeleteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

export default MessageBubble;
