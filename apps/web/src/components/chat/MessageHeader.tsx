import type { Contact } from "@whatsapp-web/shared";
import { ArrowLeft } from "lucide-react";

interface MessageHeaderProps {
  contact: Contact | undefined;
  onOpenProfile?: () => void;
  onSearch?: () => void;
  onMore?: () => void;
  /** Show back button for mobile navigation */
  showBackButton?: boolean;
  /** Callback when back button is pressed */
  onBack?: () => void;
}

export function MessageHeader({
  contact,
  onOpenProfile,
  onSearch,
  onMore,
  showBackButton = false,
  onBack,
}: MessageHeaderProps) {
  if (!contact) {
    return null;
  }

  const displayName =
    contact.customName || contact.name || contact.jid || "Unknown";
  const lastSeenText = getLastSeenText(contact.isOnline, contact.lastSeen);

  return (
    <header className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2 bg-gray-100 border-b border-gray-200 h-14 min-h-[56px] md:h-[60px] md:min-h-[60px] safe-area-top">
      {/* Back button for mobile */}
      {showBackButton && (
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 hover:bg-gray-200 active:bg-gray-300 transition-colors touch-manipulation md:hidden"
          aria-label="Go back"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
      )}

      {/* Avatar and info - clickable to open profile */}
      <button
        onClick={onOpenProfile}
        className="flex items-center gap-2 md:gap-3 flex-1 min-w-0 hover:bg-gray-200 active:bg-gray-300 rounded-lg p-1 -m-1 transition-colors touch-manipulation"
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-gray-300 overflow-hidden">
            {contact.avatarUrl ? (
              <img
                src={contact.avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-whatsapp-teal-green text-white text-lg font-medium">
                {getInitials(displayName)}
              </div>
            )}
          </div>
          {/* Online indicator */}
          {contact.isOnline && (
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-whatsapp-green rounded-full border-2 border-gray-100" />
          )}
        </div>

        {/* Name and status */}
        <div className="flex-1 min-w-0 text-left">
          <h2 className="text-base font-medium text-gray-900 truncate">
            {displayName}
          </h2>
          <p className="text-xs text-gray-500 truncate">{lastSeenText}</p>
        </div>
      </button>

      {/* Action buttons - hide search on very small screens */}
      <div className="flex items-center gap-0 md:gap-1">
        {/* Search button - hidden on small mobile */}
        <button
          onClick={onSearch}
          className="hidden sm:flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200 active:bg-gray-300 transition-colors touch-manipulation"
          aria-label="Search in conversation"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>

        {/* More options button */}
        <button
          onClick={onMore}
          className="flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200 active:bg-gray-300 transition-colors touch-manipulation"
          aria-label="More options"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

// Helper function to get initials from name
function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

// Helper function to format last seen time
function getLastSeenText(
  isOnline: boolean | undefined,
  lastSeen: Date | undefined,
): string {
  if (isOnline) {
    return "online";
  }

  if (!lastSeen) {
    return "offline";
  }

  const now = new Date();
  const lastSeenDate = new Date(lastSeen);
  const diffMs = now.getTime() - lastSeenDate.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) {
    return "last seen just now";
  }
  if (diffMinutes < 60) {
    return `last seen ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  if (diffHours < 24) {
    return `last seen ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  if (diffDays === 1) {
    return `last seen yesterday at ${formatTime(lastSeenDate)}`;
  }
  if (diffDays < 7) {
    return `last seen ${formatDay(lastSeenDate)} at ${formatTime(lastSeenDate)}`;
  }

  return `last seen ${formatDate(lastSeenDate)}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDay(date: Date): string {
  return date.toLocaleDateString([], { weekday: "long" });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default MessageHeader;
