/**
 * Message Search Results Component
 *
 * Displays message search results with highlighting and type icons.
 */

import { FileText, Image, MapPin, Music, Users, Video } from "lucide-react";
import { formatChatListTime } from "@whatsapp-web/shared";
import {
  Avatar,
  AvatarFallback,
  HighlightedText,
  Skeleton,
} from "@/components/ui";
import type { MessageSearchResult } from "@/hooks/useSearch";

/**
 * Get icon for message type
 */
function getMessageTypeIcon(type: string | null): React.ReactElement | null {
  switch (type) {
    case "image":
      return (
        <Image className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
      );
    case "video":
      return (
        <Video className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
      );
    case "audio":
      return (
        <Music className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
      );
    case "document":
      return (
        <FileText className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
      );
    case "location":
      return (
        <MapPin className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
      );
    default:
      return null;
  }
}

interface MessageResultItemProps {
  result: MessageSearchResult;
  query: string;
  onClick: () => void;
}

/**
 * Single message search result item
 */
export function MessageResultItem({
  result,
  query,
  onClick,
}: MessageResultItemProps) {
  const displayContent = result.highlights || result.content || "";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors border-b border-gray-100 dark:border-dark-border"
    >
      {/* Avatar */}
      <Avatar className="h-10 w-10 flex-shrink-0">
        {result.isGroup ? (
          <AvatarFallback className="bg-gray-400 dark:bg-dark-text-tertiary">
            <Users className="h-5 w-5 text-white" />
          </AvatarFallback>
        ) : (
          <AvatarFallback className="bg-whatsapp-teal-green text-white">
            {(result.contactName || "?").charAt(0).toUpperCase()}
          </AvatarFallback>
        )}
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
            {result.contactName || result.contactJid || "Unknown"}
          </span>
          <span className="text-xs text-gray-500 dark:text-dark-text-tertiary flex-shrink-0">
            {formatChatListTime(result.timestamp)}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-1">
          {getMessageTypeIcon(result.messageType)}
          <p className="text-sm text-gray-600 dark:text-dark-text-secondary truncate">
            <HighlightedText text={displayContent} query={query} />
          </p>
        </div>
      </div>
    </button>
  );
}

interface MessageSearchResultsProps {
  messages: MessageSearchResult[];
  query: string;
  onMessageClick: (contactId: string, messageId: string | null) => void;
  hasMore?: boolean;
  total?: number;
  onViewAll?: () => void;
  limit?: number;
}

/**
 * List of message search results
 */
export function MessageSearchResults({
  messages,
  query,
  onMessageClick,
  hasMore,
  total,
  onViewAll,
  limit,
}: MessageSearchResultsProps) {
  const displayMessages = limit ? messages.slice(0, limit) : messages;

  return (
    <div>
      {displayMessages.map((message) => (
        <MessageResultItem
          key={message.id}
          result={message}
          query={query}
          onClick={() => onMessageClick(message.contactId, message.messageId)}
        />
      ))}
      {limit && messages.length > limit && onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="w-full px-4 py-2 text-sm text-whatsapp-green hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors text-center"
        >
          View all {messages.length} messages
        </button>
      )}
      {hasMore && total && (
        <div className="px-4 py-3 text-center text-sm text-gray-500 dark:text-dark-text-secondary">
          Showing {messages.length} of {total} results
        </div>
      )}
    </div>
  );
}

/**
 * Loading skeleton for search results
 */
export function SearchResultSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 border-b border-gray-100 dark:border-dark-border">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  );
}

/**
 * Multiple loading skeletons
 */
export function SearchResultSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-gray-100 dark:divide-dark-border">
      {Array.from({ length: count }).map((_, i) => (
        <SearchResultSkeleton key={i} />
      ))}
    </div>
  );
}
