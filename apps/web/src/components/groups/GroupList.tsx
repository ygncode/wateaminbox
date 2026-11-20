import { formatChatListTime } from "@wateaminbox/shared";
import {
  MessageSquare,
  Plus,
  Search,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncData } from "@/hooks/useAsyncData";
import { type GroupListItem, useGroups } from "@/hooks/useGroups";
import { useWhatsAppConnections } from "@/hooks/useWhatsAppConnections";
import { cn } from "@/lib/utils";
import { getConnectionLabel } from "../chat/ConnectionIdentity";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { useTranslation } from "react-i18next";

export interface GroupListProps {
  selectedGroupId?: string | null;
  onGroupSelect: (groupId: string) => void;
  className?: string;
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
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("all");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const { connections } = useWhatsAppConnections();
  const { data, renderState, error } = useAsyncData(
    useGroups(
      searchQuery,
      100,
      undefined,
      connectionFilter === "all" ? undefined : connectionFilter,
    ),
  );

  useEffect(() => {
    if (
      connectionFilter !== "all" &&
      !connections.some((connection) => connection.id === connectionFilter)
    ) {
      setConnectionFilter("all");
    }
  }, [connectionFilter, connections]);

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

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-surface border-e border-line",
        className,
      )}
      role="navigation"
      aria-label={t("groups.groupList", "Group list")}
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-line">
        <div className="relative flex items-center flex-1">
          <div className="absolute start-3 pointer-events-none">
            <Search className="w-4 h-4 text-fg-subtle" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            placeholder={t("groups.searchGroups", "Search groups")}
            className="w-full py-2 ps-9 pe-8 text-sm bg-muted border border-line rounded-lg placeholder-fg-muted text-fg focus:outline-none focus:border-primary focus:ring-1 focus:ring-ring focus:bg-surface transition-all"
            aria-label={t("groups.searchGroups", "Search groups")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleSearchClear}
              className="absolute end-2 p-1 text-fg-subtle hover:text-fg-muted focus:outline-none transition-colors"
              aria-label={t("common.clearSearch", "Clear search")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className="text-xs text-fg-muted whitespace-nowrap">
          {data?.pagination.total ?? 0} groups
        </span>
        <button
          type="button"
          onClick={() => setShowCreateGroup(true)}
          aria-label={t("groups.createNewGroup", "Create a new WhatsApp group")}
          title={t("groups.newGroup", "New group")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <CreateGroupDialog
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
      />

      {/* Match the Inbox account scope for multi-number workspaces. */}
      {connections.length > 1 && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <Smartphone
            className="h-4 w-4 shrink-0 text-fg-subtle"
            aria-hidden="true"
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Inbox
          </span>
          <Select value={connectionFilter} onValueChange={setConnectionFilter}>
            <SelectTrigger
              className="ms-auto h-8 min-w-0 max-w-[190px] text-xs"
              aria-label={t(
                "groups.filterByAccount",
                "Filter groups by WhatsApp account",
              )}
            >
              <SelectValue
                placeholder={t(
                  "chat.allWhatsappNumbers",
                  "All WhatsApp numbers",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("chat.allWhatsappNumbers", "All WhatsApp numbers")}
              </SelectItem>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {getConnectionLabel(connection)}
                  {connection.status !== "connected" ? " · offline" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Group List */}
      <div
        className="flex-1 overflow-y-auto"
        role="listbox"
        aria-label={t("chat.groups", "Groups")}
      >
        {renderState({
          loading: () => (
            <div className="divide-y divide-line">
              {Array.from({ length: 8 }).map((_, index) => (
                <GroupListItemSkeleton key={index} />
              ))}
            </div>
          ),
          error: () => (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <MessageSquare className="w-12 h-12 text-danger mb-4" />
              <p className="text-fg-muted font-medium">
                {t("groups.loadFailed", "Failed to load groups")}
              </p>
              <p className="text-sm text-fg-muted mt-1">
                {error?.message || t("chat.tryAgainLater")}
              </p>
            </div>
          ),
          empty: () =>
            searchQuery ? (
              <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
                <Search className="w-12 h-12 text-fg-subtle mb-4" />
                <p className="text-fg-muted font-medium">
                  {t("groups.noGroupsFound", "No groups found")}
                </p>
                <p className="text-sm text-fg-muted mt-1">
                  No results for "{searchQuery}"
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
                <Users className="w-12 h-12 text-fg-subtle mb-4" />
                <p className="text-fg-muted font-medium">
                  {t("groups.noGroupsYet", "No groups yet")}
                </p>
                <p className="text-sm text-fg-muted mt-1">
                  {t(
                    "groups.groupsAppearHere",
                    "Groups you join will appear here",
                  )}
                </p>
              </div>
            ),
          success: (data) => (
            <div>
              {data.data.map((group) => (
                <GroupListItemComponent
                  key={group.id}
                  group={group}
                  isSelected={group.id === selectedGroupId}
                  onClick={() => handleGroupClick(group.id)}
                />
              ))}
            </div>
          ),
        })}
      </div>
    </div>
  );
}

interface GroupListItemComponentProps {
  group: GroupListItem;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Individual group list item component
 */
function GroupListItemComponent({
  group,
  isSelected,
  onClick,
}: GroupListItemComponentProps) {
  const { t } = useTranslation();

  const initials = group.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const formattedTime = group.lastMessageAt
    ? formatChatListTime(group.lastMessageAt, t)
    : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 text-start",
        "transition-colors duration-150 border-b border-line",
        isSelected ? "bg-selected" : "hover:bg-subtle",
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
          <AvatarFallback className="bg-fg-subtle text-surface">
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
              group.unreadCount > 0 ? "font-semibold text-fg" : "text-fg",
            )}
          >
            {group.displayName}
          </span>
          <span
            className={cn(
              "text-xs flex-shrink-0",
              group.unreadCount > 0
                ? "text-accent font-medium"
                : "text-fg-muted",
            )}
          >
            {formattedTime}
          </span>
        </div>

        {/* Bottom Row: Participant count and Unread Badge */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <Users className="h-3.5 w-3.5 text-fg-subtle flex-shrink-0" />
            <span className="text-sm text-fg-muted truncate">
              {/* A group this account left keeps its history but can no longer
                  be administered, so the state is worth showing up front. */}
              {!group.isMember
                ? t("groups.youLeft", "You left this group")
                : group.participantCount === null
                  ? t(
                      "groups.participantCountUnavailable",
                      "Participant count unavailable",
                    )
                  : `${group.participantCount} participants`}
            </span>
          </div>

          {/* Unread Badge */}
          {group.unreadCount > 0 && (
            <span
              className="flex items-center justify-center min-w-[20px] h-5 px-1.5
                         text-xs font-medium text-on-primary bg-primary rounded-full flex-shrink-0"
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
    <div className="flex items-center gap-3 px-3 py-3 border-b border-line">
      <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="mt-2">
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}
