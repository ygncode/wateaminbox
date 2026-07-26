import type { Contact } from "@wateaminbox/shared";
import { formatLastSeen } from "@wateaminbox/shared";
import { ArrowLeft } from "lucide-react";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { useGroup } from "@/hooks/useGroups";
import { formatPhoneLikeText } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

interface MessageHeaderProps {
  contact: Contact | undefined;
  onOpenProfile?: () => void;
  onSearch?: () => void;
  onMore?: () => void;
  /** Show back button for mobile navigation */
  showBackButton?: boolean;
  /** Callback when back button is pressed */
  onBack?: () => void;
  /** Whether the contact is currently typing */
  isTyping?: boolean;
}

export function MessageHeader({
  contact,
  onOpenProfile,
  onSearch,
  onMore,
  showBackButton = false,
  onBack,
  isTyping = false,
}: MessageHeaderProps) {
  const { data: group } = useGroup(contact?.isGroup ? contact.id : null);

  if (!contact) {
    return null;
  }

  const displayName = formatPhoneLikeText(
    contact.customName || contact.name || contact.jid || "Unknown",
  );
  const lastSeenText = contact.isGroup
    ? group?.participantCount
      ? `${group.participantCount} participants`
      : "Group"
    : formatLastSeen(contact.lastSeen, contact.isOnline);
  const statusText = isTyping ? "typing" : lastSeenText;

  return (
    <header className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2 bg-gray-100 dark:bg-dark-secondary border-b border-gray-200 dark:border-dark-border h-14 min-h-[56px] md:h-[60px] md:min-h-[60px] safe-area-top">
      {/* Back button for mobile */}
      {showBackButton && (
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 dark:text-dark-text-secondary hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation md:hidden"
          aria-label="Go back"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
      )}

      {/* Avatar and info - clickable to open profile */}
      <button
        onClick={onOpenProfile}
        className="flex items-center gap-2 md:gap-3 flex-1 min-w-0 hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border rounded-lg p-1 -m-1 transition-colors touch-manipulation"
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-dark-tertiary overflow-hidden">
            {contact.avatarUrl ? (
              <img
                src={contact.avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <IdentityAvatarFallback
                displayName={displayName}
                identity={contact.jid || contact.phoneNumber || contact.id}
                kind={contact.isGroup ? "group" : "user"}
                className="text-lg"
              />
            )}
          </div>
          {/* Online indicator */}
          {contact.isOnline && (
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-whatsapp-green rounded-full border-2 border-gray-100 dark:border-dark-secondary" />
          )}
        </div>

        {/* Name and status */}
        <div className="flex-1 min-w-0 text-left">
          <h2 className="text-base font-medium text-gray-900 dark:text-dark-text-primary truncate">
            {displayName}
          </h2>
          {statusText && (
            <p
              className={`text-xs truncate ${isTyping ? "text-whatsapp-green" : "text-gray-500 dark:text-dark-text-secondary"}`}
            >
              {isTyping ? (
                <span className="typing-indicator">
                  typing
                  <span className="typing-dots" />
                </span>
              ) : (
                statusText
              )}
            </p>
          )}
        </div>
      </button>

      {/* Action buttons - hide search on very small screens */}
      <div className="flex items-center gap-0 md:gap-1">
        {/* The desktop theme control lives in the navigation rail. */}
        <div className="lg:hidden">
          <ThemeToggle />
        </div>

        {/* Search button - hidden on small mobile */}
        <button
          onClick={onSearch}
          className="hidden sm:flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary rounded-full hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation"
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
          className="flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary rounded-full hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation"
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

export default MessageHeader;
