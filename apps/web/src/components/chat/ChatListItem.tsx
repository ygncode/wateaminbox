import { useMemo, memo } from "react";
import type { ChatListItemProps } from "../../types/chat";

/**
 * Format timestamp for display in chat list
 * Shows time for today, day name for this week, or date for older messages
 */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const daysDiff = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (daysDiff === 0) {
    // Today - show time
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (daysDiff === 1) {
    return "Yesterday";
  } else if (daysDiff < 7) {
    // This week - show day name
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    // Older - show date
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

/**
 * Truncate message content for preview display
 */
function truncateMessage(content: string, maxLength: number = 45): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength).trim() + "...";
}

/**
 * Individual chat list item component
 * Displays avatar, contact name, last message preview, timestamp, and unread count
 */
export const ChatListItem = memo(function ChatListItem({
  chat,
  isSelected,
  onClick,
}: ChatListItemProps) {
  const { contact, lastMessage, unreadCount } = chat;
  const displayName =
    contact.customName || contact.name || contact.jid || "Unknown";

  const formattedTime = useMemo(() => {
    if (!lastMessage) return "";
    return formatTimestamp(lastMessage.timestamp);
  }, [lastMessage]);

  const messagePreview = useMemo(() => {
    if (!lastMessage) return "No messages yet";

    // Add prefix for sent messages
    const prefix = lastMessage.isFromMe ? "You: " : "";

    if (lastMessage.isDeleted) {
      return prefix + "This message was deleted";
    }

    switch (lastMessage.type) {
      case "image":
        return prefix + "Photo";
      case "video":
        return prefix + "Video";
      case "audio":
        return prefix + "Audio";
      case "document":
        return prefix + "Document";
      case "sticker":
        return prefix + "Sticker";
      case "location":
        return prefix + "Location";
      case "contact":
        return prefix + "Contact";
      default:
        return prefix + truncateMessage(lastMessage.content);
    }
  }, [lastMessage]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 text-left
                  transition-colors duration-150 border-b border-gray-100
                  touch-manipulation active:bg-gray-200
                  ${isSelected ? "bg-gray-200" : "hover:bg-gray-50"}
                  py-3 md:py-3 min-h-[72px] md:min-h-0`}
      aria-selected={isSelected}
      role="option"
    >
      {/* Avatar with Online Indicator */}
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200">
          {contact.avatarUrl ? (
            <img
              src={contact.avatarUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : contact.isGroup ? (
            // Group avatar - show group icon
            <div className="w-full h-full flex items-center justify-center bg-gray-400 text-white">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.62c0-1.17.68-2.25 1.76-2.73 1.17-.51 2.61-.9 4.24-.9zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58A2.01 2.01 0 000 16.43V18h4.5v-1.62c0-.83.23-1.61.63-2.28zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85A6.95 6.95 0 0020 14c-.39 0-.76.04-1.13.1.4.67.63 1.45.63 2.28V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z" />
              </svg>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-whatsapp-teal-green text-white text-lg font-medium">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        {/* Online Indicator - only for individual contacts */}
        {!contact.isGroup && contact.isOnline && (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 bg-whatsapp-green
                       border-2 border-white rounded-full"
            aria-label="Online"
          />
        )}
      </div>

      {/* Chat Info */}
      <div className="flex-1 min-w-0">
        {/* Top Row: Name and Time */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-base truncate ${
              unreadCount > 0 ? "font-semibold text-gray-900" : "text-gray-900"
            }`}
          >
            {displayName}
          </span>
          <span
            className={`text-xs flex-shrink-0 ${
              unreadCount > 0
                ? "text-whatsapp-green font-medium"
                : "text-gray-500"
            }`}
          >
            {formattedTime}
          </span>
        </div>

        {/* Bottom Row: Message Preview and Unread Badge */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {/* Message Status Icon for sent messages */}
            {lastMessage?.isFromMe && !lastMessage.isDeleted && (
              <span className="flex-shrink-0">
                {lastMessage.status === "read" && (
                  <svg
                    className="w-4 h-4 text-blue-500"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
                  </svg>
                )}
                {lastMessage.status === "delivered" && (
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
                  </svg>
                )}
                {lastMessage.status === "sent" && (
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                )}
                {lastMessage.status === "sending" && (
                  <svg
                    className="w-4 h-4 text-gray-400 animate-pulse"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                )}
              </span>
            )}
            <span
              className={`text-sm truncate ${
                unreadCount > 0 ? "text-gray-700" : "text-gray-500"
              }`}
            >
              {messagePreview}
            </span>
          </div>

          {/* Indicators: Muted, Pinned, Unread */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Muted Icon */}
            {chat.isMuted && (
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                />
              </svg>
            )}

            {/* Pinned Icon */}
            {chat.isPinned && (
              <svg
                className="w-4 h-4 text-gray-400"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
              </svg>
            )}

            {/* Unread Badge */}
            {unreadCount > 0 && (
              <span
                className="flex items-center justify-center min-w-[20px] h-5 px-1.5
                           text-xs font-medium text-white bg-whatsapp-green rounded-full"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
});

/**
 * Loading skeleton for chat list item
 */
export function ChatListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-b border-gray-100 animate-pulse">
      {/* Avatar Skeleton */}
      <div className="w-12 h-12 rounded-full bg-gray-200 flex-shrink-0" />

      {/* Content Skeleton */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="h-4 bg-gray-200 rounded w-32" />
          <div className="h-3 bg-gray-200 rounded w-12" />
        </div>
        <div className="mt-2 h-3 bg-gray-200 rounded w-48" />
      </div>
    </div>
  );
}

export default ChatListItem;
