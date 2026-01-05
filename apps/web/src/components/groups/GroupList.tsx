import { useState, useCallback, useMemo } from "react";
import { useGroups, type GroupListItem } from "@/hooks/useGroups";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui";
import { Users, Search, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GroupListProps {
  selectedGroupId?: string | null;
  onGroupSelect: (groupId: string) => void;
  className?: string;
}

/**
 * Format timestamp for display in group list
 * Shows time for today, day name for this week, or date for older
 */
function formatTimestamp(dateString: string | null): string {
  if (!dateString) return "";

  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const daysDiff = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (daysDiff === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (daysDiff === 1) {
    return "Yesterday";
  } else if (daysDiff < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

/**
 * Main group list sidebar component
 * Displays searchable list of groups with avatars, participant count, and unread badges
 */
export function GroupList({
  selectedGroupId,
  onGroupSelect,
  className = "",
}: GroupListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, isError, error } = useGroups(searchQuery, 100);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setSearchQuery("");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleSearchClear();
      }
    },
    [handleSearchClear],
  );

  const handleGroupClick = useCallback(
    (groupId: string) => {
      onGroupSelect(groupId);
    },
    [onGroupSelect],
  );

  const groups = useMemo(() => data?.data ?? [], [data]);

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-white dark:bg-dark-primary border-r border-gray-200 dark:border-dark-border",
        className,
      )}
      role="navigation"
      aria-label="Group list"
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-dark-secondary border-b border-gray-200 dark:border-dark-border">
        <div className="relative flex items-center flex-1">
          <div className="absolute left-3 pointer-events-none">
            <Search className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            placeholder="Search groups"
            className="w-full py-2 pl-9 pr-8 text-sm bg-gray-100 dark:bg-dark-tertiary border border-gray-200 dark:border-dark-border rounded-lg placeholder-gray-500 dark:placeholder-dark-text-tertiary text-gray-900 dark:text-dark-text-primary focus:outline-none focus:border-whatsapp-green focus:ring-1 focus:ring-whatsapp-green focus:bg-white dark:focus:bg-dark-elevated transition-all"
            aria-label="Search groups"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleSearchClear}
              className="absolute right-2 p-1 text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary focus:outline-none transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className="text-xs text-gray-500 dark:text-dark-text-secondary whitespace-nowrap">
          {data?.pagination.total ?? 0} groups
        </span>
      </div>

      {/* Group List */}
      <div
        className="flex-1 overflow-y-auto"
        role="listbox"
        aria-label="Groups"
      >
        {/* Loading State */}
        {isLoading && (
          <div className="divide-y divide-gray-100 dark:divide-dark-border">
            {Array.from({ length: 8 }).map((_, index) => (
              <GroupListItemSkeleton key={index} />
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <MessageSquare className="w-12 h-12 text-red-400 dark:text-red-500 mb-4" />
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">Failed to load groups</p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              {error?.message || "Please try again later"}
            </p>
          </div>
        )}

        {/* Empty State - No Search Results */}
        {!isLoading && !isError && groups.length === 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <Search className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4" />
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">No groups found</p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              No results for "{searchQuery}"
            </p>
          </div>
        )}

        {/* Empty State - No Groups */}
        {!isLoading && !isError && groups.length === 0 && !searchQuery && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <Users className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4" />
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">No groups yet</p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              Groups you join will appear here
            </p>
          </div>
        )}

        {/* Group List Items */}
        {!isLoading && !isError && groups.length > 0 && (
          <div>
            {groups.map((group) => (
              <GroupListItem
                key={group.id}
                group={group}
                isSelected={group.id === selectedGroupId}
                onClick={() => handleGroupClick(group.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface GroupListItemProps {
  group: GroupListItem;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Individual group list item component
 */
function GroupListItem({ group, isSelected, onClick }: GroupListItemProps) {
  const initials = group.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const formattedTime = formatTimestamp(group.lastMessageAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 text-left",
        "transition-colors duration-150 border-b border-gray-100 dark:border-dark-border",
        isSelected ? "bg-gray-200 dark:bg-dark-tertiary" : "hover:bg-gray-50 dark:hover:bg-dark-elevated",
      )}
      aria-selected={isSelected}
      role="option"
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <Avatar className="h-12 w-12">
          <AvatarImage
            src={group.profilePictureUrl || undefined}
            alt={group.displayName}
          />
          <AvatarFallback className="bg-gray-400 dark:bg-dark-tertiary text-white dark:text-dark-text-primary">
            {group.profilePictureUrl ? initials : <Users className="h-6 w-6" />}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Group Info */}
      <div className="flex-1 min-w-0">
        {/* Top Row: Name and Time */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-base truncate",
              group.unreadCount > 0
                ? "font-semibold text-gray-900 dark:text-dark-text-primary"
                : "text-gray-900 dark:text-dark-text-primary",
            )}
          >
            {group.displayName}
          </span>
          <span
            className={cn(
              "text-xs flex-shrink-0",
              group.unreadCount > 0
                ? "text-whatsapp-green font-medium"
                : "text-gray-500 dark:text-dark-text-secondary",
            )}
          >
            {formattedTime}
          </span>
        </div>

        {/* Bottom Row: Participant count and Unread Badge */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <Users className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary flex-shrink-0" />
            <span className="text-sm text-gray-500 dark:text-dark-text-secondary truncate">
              {group.participantCount ?? 0} participants
            </span>
          </div>

          {/* Unread Badge */}
          {group.unreadCount > 0 && (
            <span
              className="flex items-center justify-center min-w-[20px] h-5 px-1.5
                         text-xs font-medium text-white bg-whatsapp-green rounded-full flex-shrink-0"
            >
              {group.unreadCount > 99 ? "99+" : group.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * Loading skeleton for group list item
 */
function GroupListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-b border-gray-100 dark:border-dark-border">
      <Skeleton className="w-12 h-12 rounded-full flex-shrink-0 dark:bg-dark-tertiary" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-32 dark:bg-dark-tertiary" />
          <Skeleton className="h-3 w-12 dark:bg-dark-tertiary" />
        </div>
        <div className="mt-2">
          <Skeleton className="h-3 w-24 dark:bg-dark-tertiary" />
        </div>
      </div>
    </div>
  );
}

export default GroupList;
