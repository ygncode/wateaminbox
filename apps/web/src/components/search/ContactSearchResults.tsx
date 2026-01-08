/**
 * Contact Search Results Component
 *
 * Displays contact search results with highlighting.
 */

import { Users } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  HighlightedText,
} from "@/components/ui";
import type { ContactSearchResult } from "@/hooks/useSearch";

interface ContactResultItemProps {
  result: ContactSearchResult;
  query: string;
  onClick: () => void;
}

/**
 * Single contact search result item
 */
export function ContactResultItem({
  result,
  query,
  onClick,
}: ContactResultItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors border-b border-gray-100 dark:border-dark-border"
    >
      {/* Avatar */}
      <Avatar className="h-10 w-10 flex-shrink-0">
        {result.profilePictureUrl ? (
          <AvatarImage
            src={result.profilePictureUrl}
            alt={result.displayName}
          />
        ) : null}
        {result.isGroup ? (
          <AvatarFallback className="bg-gray-400 dark:bg-dark-text-tertiary">
            <Users className="h-5 w-5 text-white" />
          </AvatarFallback>
        ) : (
          <AvatarFallback className="bg-whatsapp-teal-green text-white">
            {result.displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        )}
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
            <HighlightedText text={result.displayName} query={query} />
          </span>
          {result.isGroup && (
            <Badge variant="secondary" className="text-xs">
              Group
            </Badge>
          )}
        </div>
        {result.phoneNumber && (
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-0.5">
            <HighlightedText text={result.phoneNumber} query={query} />
          </p>
        )}
        {result.notesShared && (
          <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-0.5 truncate">
            <HighlightedText text={result.notesShared} query={query} />
          </p>
        )}
      </div>
    </button>
  );
}

interface ContactSearchResultsProps {
  contacts: ContactSearchResult[];
  query: string;
  onContactClick: (contactId: string) => void;
  hasMore?: boolean;
  total?: number;
  onViewAll?: () => void;
  limit?: number;
}

/**
 * List of contact search results
 */
export function ContactSearchResults({
  contacts,
  query,
  onContactClick,
  hasMore,
  total,
  onViewAll,
  limit,
}: ContactSearchResultsProps) {
  const displayContacts = limit ? contacts.slice(0, limit) : contacts;

  return (
    <div>
      {displayContacts.map((contact) => (
        <ContactResultItem
          key={contact.id}
          result={contact}
          query={query}
          onClick={() => onContactClick(contact.id)}
        />
      ))}
      {limit && contacts.length > limit && onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="w-full px-4 py-2 text-sm text-whatsapp-green hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors text-center"
        >
          View all {contacts.length} contacts
        </button>
      )}
      {hasMore && total && (
        <div className="px-4 py-3 text-center text-sm text-gray-500 dark:text-dark-text-secondary">
          Showing {contacts.length} of {total} results
        </div>
      )}
    </div>
  );
}
