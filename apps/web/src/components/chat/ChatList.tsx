import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ListFilter,
  Smartphone,
  Tags,
  UserPlus,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { catalogEntryForAccount } from "@/components/connections/channel-catalog";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../../contexts/workspace-context";
import { type Tag, useTags } from "../../hooks/contact/useContactTags";
import { useDebounce } from "../../hooks/ui";
import { useChannelAccounts } from "../../hooks/useChannelAccounts";
import type {
  AssignmentFilter,
  ConversationStatusFilter,
} from "../../hooks/useChats";
import { inboxKeys, useInbox } from "../../hooks/useInbox";
import { usePrefetchContact } from "../../hooks/usePrefetch";
import { useWhatsAppConnections } from "../../hooks/useWhatsAppConnections";
import { workspacePath } from "../../lib/workspace-routes";
import type { ChatListProps } from "../../types/chat";
import { BrandMark } from "../brand/BrandMark";
import { AddContactDialog } from "../contacts/AddContactDialog";
import { TagSearchInput } from "../tags/TagSearchInput";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ChatListItemSkeleton } from "./ChatListItem";
import { ChatListSearch } from "./ChatListSearch";
import { getConnectionLabel } from "./ConnectionIdentity";
import {
  CONVERSATION_STATUS_OPTIONS,
  dedupeInboxAccounts,
  readChatListFilters,
  writeChatListFilters,
} from "./chat-list-filters";
import {
  observeChatListEnd,
  shouldLoadNewerChats,
} from "./chat-list-pagination";
import { resolveInboxConnectionState } from "./inbox-connection-state";
import { VirtualizedChatRows } from "./VirtualizedChatRows";

const MAX_TAG_FILTERS = 50;

const ASSIGNMENT_OPTIONS = [
  { value: "all", labelKey: "chat.allConversations", label: "All conversations" },
  { value: "unread", labelKey: "chat.unread", label: "Unread" },
  { value: "assignedToMe", labelKey: "chat.assignedToMe", label: "Assigned to me" },
  { value: "unassigned", labelKey: "chat.unassigned", label: "Unassigned" },
] as const satisfies ReadonlyArray<{
  value: AssignmentFilter;
  labelKey: string;
  label: string;
}>;

/**
 * Main chat list sidebar component
 * Displays searchable list of chats with last message preview
 */
export const ChatList = memo(function ChatList({
  selectedChatId,
  onChatSelect,
  className = "",
}: ChatListProps) {
  const { t } = useTranslation();
  const { activeWorkspace, can } = useWorkspace();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  // Restored once on mount so a refresh lands back on the view the user left.
  const [restoredFilters] = useState(readChatListFilters);
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>(
    restoredFilters.assignment,
  );
  const [conversationStatusFilter, setConversationStatusFilter] =
    useState<ConversationStatusFilter>(restoredFilters.status);
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState("all");
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const selectedTagIds = useMemo(
    () => selectedTags.map((tag) => tag.id),
    [selectedTags],
  );
  const [tagSearch, setTagSearch] = useState("");
  const debouncedTagSearch = useDebounce(tagSearch.trim(), 250);
  const { data: tagResults = [], isFetching: isFetchingTags } = useTags({
    search: debouncedTagSearch || undefined,
    limit: 100,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The virtualized rows read the scroll element during their own layout
  // effect. When the list remounts with cached chats (switching back from the
  // Groups tab), the rows mount in the same commit as this container and their
  // effect runs before the ancestor's ref is attached, so the virtualizer saw
  // no scroll element and rendered nothing until something else re-rendered
  // it. Keeping the element in state re-renders the rows once it exists.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const attachScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollElement(node);
  }, []);
  const paginationFooterRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);
  const {
    connections,
    isLoading: areConnectionsLoading,
    isError: areConnectionsUnavailable,
  } = useWhatsAppConnections();
  const {
    data: channelAccounts = [],
    isLoading: areChannelAccountsLoading,
    isError: areChannelAccountsUnavailable,
  } = useChannelAccounts();

  useEffect(() => {
    if (
      accountFilter !== "all" &&
      !connections.some((connection) => connection.id === accountFilter) &&
      !channelAccounts.some((account) => account.id === accountFilter)
    ) {
      setAccountFilter("all");
    }
  }, [accountFilter, channelAccounts, connections]);

  useEffect(() => {
    writeChatListFilters({
      status: conversationStatusFilter,
      assignment: assignmentFilter,
    });
  }, [conversationStatusFilter, assignmentFilter]);

  // One server-ordered list for every channel (GET /api/inbox). Filters and
  // search are applied on the server for WhatsApp customers and channel
  // threads alike, so the list is never merged or filtered here.
  const {
    data: chats,
    isLoading,
    isError: chatsFailed,
    error,
    hasNextPage = false,
    hasPreviousPage = false,
    fetchPreviousPage,
    isFetchPreviousPageError: previousPageFailed,
    isFetching,
    isFetchNextPageError: nextPageFailed,
    fetchNextPage,
    refetch: refetchChats,
  } = useInbox({
    search: searchQuery,
    includeGroups: true,
    assignmentFilter,
    accountId: accountFilter !== "all" ? accountFilter : undefined,
    conversationStatus: conversationStatusFilter,
    tagIds: selectedTagIds,
  });
  // A later-page failure must not replace the already-loaded list with an error.
  const isError = chatsFailed && !chats;
  const paginationError = chatsFailed;

  const loadMore = useCallback(() => {
    // Avoid cancelling a realtime refetch or repeatedly retrying a failed page.
    if (isFetching || paginationError) return;
    if (hasNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [isFetching, paginationError, hasNextPage, fetchNextPage]);

  const loadPrevious = useCallback(() => {
    if (isFetching || paginationError) return;
    if (hasPreviousPage) void fetchPreviousPage({ cancelRefetch: false });
  }, [isFetching, paginationError, hasPreviousPage, fetchPreviousPage]);

  const backToLatest = useCallback(() => {
    scrollPositionRef.current = 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    void queryClient.resetQueries({
      queryKey: inboxKeys.all(),
      type: "active",
    });
  }, [queryClient]);

  const listScope = JSON.stringify([
    activeWorkspace?.id,
    searchQuery,
    assignmentFilter,
    accountFilter,
    conversationStatusFilter,
    selectedTagIds,
  ]);
  useEffect(() => {
    scrollPositionRef.current = 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    // Returning to a cached filter should start at the top of the inbox, not
    // at an old window reached on a previous visit. A window that already
    // starts at the top (no cursor) is left alone so a fresh load is not
    // cancelled.
    void queryClient.resetQueries({
      queryKey: inboxKeys.all(),
      type: "active",
      predicate: (query) => {
        const first = (
          query.state.data as
            | { pageParams?: Array<{ cursor?: string; before?: string }> }
            | undefined
        )?.pageParams?.[0];
        return Boolean(first?.cursor || first?.before);
      },
    });
  }, [listScope, queryClient]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    const footer = paginationFooterRef.current;
    if (!root || !footer || !hasNextPage) return;
    return observeChatListEnd(root, footer, loadMore);
  }, [hasNextPage, loadMore]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchQuery("");
  }, []);

  const handleChatClick = useCallback(
    (chatId: string) => {
      onChatSelect(chatId);
    },
    [onChatSelect],
  );

  const toggleTagFilter = useCallback((tag: Tag) => {
    setSelectedTags((current) =>
      current.some((selected) => selected.id === tag.id)
        ? current.filter((selected) => selected.id !== tag.id)
        : current.length < MAX_TAG_FILTERS
          ? [...current, tag]
          : current,
    );
  }, []);

  const clearTagFilters = useCallback(() => setSelectedTags([]), []);

  const handleFilterWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const filterList = event.currentTarget;
    if (filterList.scrollWidth <= filterList.clientWidth) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

    filterList.scrollLeft += event.deltaY;
  }, []);

  // Prefetch contact data on hover for faster navigation
  const prefetchContact = usePrefetchContact();

  /**
   * Everything that routes conversations into this inbox, on any channel.
   *
   * The scope selector used to list WhatsApp connections only, and only
   * appeared past one of them - so a workspace with one WhatsApp number and
   * one Telegram bot saw no selector at all, despite having two inboxes to
   * choose between.
   */
  const inboxAccounts = useMemo(() => {
    // The spine mirrors each WhatsApp connection into a channel account under
    // the same id, so the two sources overlap and must be reconciled before
    // they are listed together.
    const scoped = dedupeInboxAccounts(connections, channelAccounts);
    return [
      ...scoped.connections.map((connection) => ({
        id: connection.id,
        kind: "whatsapp" as const,
        label: getConnectionLabel(connection),
        offline: connection.status !== "connected",
        entry: catalogEntryForAccount("whatsapp", "whatsapp_linked_device"),
      })),
      ...scoped.channelAccounts.map((account) => {
        const entry = catalogEntryForAccount(account.channel, account.provider);
        return {
          id: account.id,
          kind: "channel" as const,
          label: account.displayName?.trim() || entry?.name || account.channel,
          offline: account.status !== "connected",
          entry,
        };
      }),
    ];
  }, [channelAccounts, connections]);

  // The server already ordered and filtered every row; only archived rows are
  // hidden here.
  const visibleChats = useMemo(
    () => (chats ?? []).filter((chat) => !chat.isArchived),
    [chats],
  );
  const connectionState = resolveInboxConnectionState({
    connections,
    channelAccounts,
    isLoading: areConnectionsLoading || areChannelAccountsLoading,
    isError: areConnectionsUnavailable || areChannelAccountsUnavailable,
  });
  const isEmpty =
    !isLoading &&
    !paginationError &&
    !hasNextPage &&
    !hasPreviousPage &&
    visibleChats.length === 0;
  const isFirstRun = connectionState === "no-connections" && isEmpty;
  const activeFilterCount =
    (assignmentFilter !== "all" ? 1 : 0) + selectedTags.length;
  // Name the account on each row only when there is more than one to tell
  // apart and the list is not already scoped to one.
  const showRowAccount = inboxAccounts.length > 1 && accountFilter === "all";

  return (
    <div
      className={`flex flex-col h-full bg-panel border-e border-line ${className}`}
      role="navigation"
      aria-label={t("chat.chatListAria", "Chat list")}
    >
      {/* Search, the account scope (multi-account inboxes only) and new
          contact share one row, so the first conversation sits high. */}
      <div
        className={
          isFirstRun ? "hidden" : "flex items-center gap-2 bg-panel px-3 pt-3 pb-2"
        }
      >
        <div className="min-w-0 flex-1">
          <ChatListSearch
            value={searchQuery}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
          />
        </div>
        {inboxAccounts.length > 1 && (
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger
                className="h-9 w-auto max-w-[10.5rem] text-xs"
                aria-label={t("chat.filterByAccount", "Filter by account")}
              >
                <SelectValue
                  placeholder={t("chat.allAccounts", "All accounts")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" hideIndicator>
                  <span className="flex items-center gap-2">
                    <BrandMark className="size-4 shrink-0 rounded-[0.25rem] object-contain" />
                    {t("chat.allAccounts", "All accounts")}
                  </span>
                </SelectItem>
                {inboxAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id} hideIndicator>
                    <span className="flex min-w-0 items-center gap-2">
                      {account.entry ? (
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-[0.25rem]",
                            account.entry.tileClassName,
                          )}
                        >
                          <account.entry.Mark className="size-3" />
                        </span>
                      ) : null}
                      <span className="truncate">
                        {account.label}
                        {account.offline
                          ? ` · ${t("chat.offline", "Offline").toLowerCase()}`
                          : ""}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
        )}
        {connectionState !== "no-connections" && (
          <button
            type="button"
            onClick={() => setIsAddContactOpen(true)}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={t("contacts.addNew", "Add new contact")}
            title={t("contacts.addNew", "Add new contact")}
            data-testid="add-contact-button"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Lifecycle as one quiet segmented control; assignment and tags live
          behind a single Filter menu (see chat-list-filters.ts). */}
      <div
        className={
          isFirstRun
            ? "hidden"
            : "flex items-center gap-2 border-b border-line bg-panel px-3 pb-2.5"
        }
      >
        <div
          role="radiogroup"
          aria-label={t("chat.statusFilters", "Conversation status filters")}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg bg-chip p-0.5 [scrollbar-width:none]"
          onWheel={handleFilterWheel}
        >
          {CONVERSATION_STATUS_OPTIONS.map((option) => {
            const active = conversationStatusFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setConversationStatusFilter(option.value)}
                className={cn(
                  "h-7 min-w-0 flex-1 whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active
                    ? "bg-chip-on text-on-chip-on shadow-xs"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {t(option.labelKey, option.label)}
              </button>
            );
          })}
        </div>

        <Popover onOpenChange={(open) => !open && setTagSearch("")}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                activeFilterCount > 0
                  ? "bg-chip-on text-on-chip-on shadow-xs ring-1 ring-line"
                  : "text-fg-muted hover:bg-muted hover:text-fg",
              )}
              aria-label={
                activeFilterCount > 0
                  ? t("chat.filtersActive", {
                      defaultValue: "Filters, {{count}} active",
                      count: activeFilterCount,
                    })
                  : t("chat.filters", "Filters")
              }
            >
              <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t("chat.filter", "Filter")}</span>
              {activeFilterCount > 0 && (
                <span className="grid min-w-4 place-items-center rounded-full bg-unread px-1 text-[10px] leading-4 text-on-unread tabular-nums">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(21rem,calc(100vw-1rem))] overflow-hidden rounded-xl border-line p-0 shadow-lg"
          >
            <div className="border-b border-line p-1.5">
              <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-fg-subtle">
                {t("chat.show", "Show")}
              </p>
              {ASSIGNMENT_OPTIONS.map((option) => {
                const active = assignmentFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => setAssignmentFilter(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                      active ? "bg-muted text-fg" : "text-fg hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      {t(option.labelKey, option.label)}
                    </span>
                    {active && (
                      <Check className="h-4 w-4 shrink-0 text-fg" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-fg-muted">
                <Tags className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">
                  {t("chat.filterByTagsTitle", "Filter by tags")}
                </p>
                <p className="text-[11px] text-fg-muted">
                  {t(
                    "chat.filterByTagsHint",
                    "Show chats matching any selected tag",
                  )}
                </p>
              </div>
            </div>

            <div className="px-3 pb-3">
              <TagSearchInput
                value={tagSearch}
                onChange={setTagSearch}
                autoFocus
              />
            </div>

            {selectedTags.length > 0 && (
              <div className="border-y border-accent/15 bg-accent/[0.06] px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
                    {t("chat.selectedCount", {
                      defaultValue: "Selected · {{count}}",
                      count: selectedTags.length,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={clearTagFilters}
                    className="rounded px-1 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {t("chat.clearAll", "Clear all")}
                  </button>
                </div>
                <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                  {selectedTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTagFilter(tag)}
                      className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-1 ps-2 pe-1.5 text-xs text-fg shadow-sm transition-colors hover:border-danger/30 hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      aria-label={`Remove ${tag.name} tag filter`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-fg-subtle"
                        style={
                          tag.color ? { backgroundColor: tag.color } : undefined
                        }
                        aria-hidden="true"
                      />
                      <span className="max-w-44 truncate">{tag.name}</span>
                      <X
                        className="h-3 w-3 shrink-0 text-fg-subtle group-hover:text-current"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div
              className="max-h-64 overflow-y-auto p-1.5"
              role="group"
              aria-label={t("chat.availableTags", "Available tags")}
            >
              {isFetchingTags && tagResults.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-fg-muted">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-primary" />
                  {t("chat.searchingTags", "Searching tags…")}
                </div>
              ) : tagResults.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Tags className="mx-auto mb-2 h-5 w-5 text-fg-subtle" />
                  <p className="text-xs font-medium text-fg">
                    {debouncedTagSearch
                      ? t("chat.noMatchingTags", "No matching tags")
                      : t("chat.noTagsYet", "No tags yet")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-fg-muted">
                    {debouncedTagSearch
                      ? t("chat.tryAnotherTagSearch", {
                          defaultValue: "Try another search for “{{query}}”",
                          query: debouncedTagSearch,
                        })
                      : t(
                          "chat.createTagHint",
                          "Create a tag from a contact profile",
                        )}
                  </p>
                </div>
              ) : (
                tagResults.map((tag) => {
                  const selected = selectedTags.some(
                    (selectedTag) => selectedTag.id === tag.id,
                  );
                  const disabled =
                    !selected && selectedTags.length >= MAX_TAG_FILTERS;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      disabled={disabled}
                      onClick={() => toggleTagFilter(tag)}
                      title={
                        disabled
                          ? `You can select up to ${MAX_TAG_FILTERS} tags`
                          : undefined
                      }
                      className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-start text-sm transition-colors last:mb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45 ${
                        selected
                          ? "bg-accent/[0.08] text-fg"
                          : "text-fg hover:bg-muted"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full bg-fg-subtle ring-2 ring-white"
                        style={
                          tag.color ? { backgroundColor: tag.color } : undefined
                        }
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {tag.name}
                      </span>
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                          selected
                            ? "border-primary bg-primary text-on-primary"
                            : "border-line bg-raised text-transparent"
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Add Contact Dialog */}
      <AddContactDialog
        open={isAddContactOpen}
        onOpenChange={setIsAddContactOpen}
      />

      {hasPreviousPage && (
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1 text-xs">
          <button
            type="button"
            disabled={isFetching || paginationError}
            onClick={loadPrevious}
            className="rounded px-2 py-1 text-accent hover:underline disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {t("chat.loadNewer", "Load newer chats")}
          </button>
          <button
            type="button"
            disabled={isFetching}
            onClick={backToLatest}
            className="rounded px-2 py-1 text-accent hover:underline disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {t("chat.backToLatest", "Back to latest")}
          </button>
        </div>
      )}

      {/* Chat List */}
      <div
        ref={attachScrollContainer}
        className="flex-1 overflow-y-auto [overflow-anchor:none]"
        onScroll={(event) => {
          const root = event.currentTarget;
          const loadNewer = shouldLoadNewerChats(
            root,
            scrollPositionRef.current,
          );
          scrollPositionRef.current = root.scrollTop;
          if (hasPreviousPage && loadNewer) loadPrevious();
        }}
        role="listbox"
        aria-label={t("chat.conversations", "Conversations")}
        aria-live="polite"
        aria-busy={isFetching || connectionState === "loading"}
      >
        {/* Loading State */}
        {!isError &&
          visibleChats.length === 0 &&
          (isLoading || connectionState === "loading") && (
            <div className="divide-y divide-line">
              {Array.from({ length: 8 }).map((_, index) => (
                <ChatListItemSkeleton key={index} />
              ))}
            </div>
          )}

        {/* Error State */}
        {isError && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg
              className="w-12 h-12 text-danger mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-fg font-medium">
              {t("chat.loadFailed", "Failed to load chats")}
            </p>
            <p className="text-sm text-fg-muted mt-1">
              {error?.message ||
                t("errors.tryAgainLater", "Please try again later")}
            </p>
          </div>
        )}

        {/* Empty State - No Search Results */}
        {isEmpty && searchQuery && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg
              className="w-12 h-12 text-fg-subtle mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <p className="text-fg font-medium">
              {t("chat.noChats", "No chats found")}
            </p>
            <p className="text-sm text-fg-muted mt-1">
              {t("chat.noResultsFor", {
                defaultValue: 'No results for "{{query}}"',
                query: searchQuery,
              })}
            </p>
          </div>
        )}

        {/* Empty State - No conversations match the selected tags */}
        {isEmpty && !searchQuery && selectedTags.length > 0 && (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <Tags className="mb-4 h-11 w-11 text-fg-subtle" />
            <p className="font-medium text-fg">
              {t("chat.noTaggedConversations", "No tagged conversations found")}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {t(
                "chat.noTaggedConversationsHint",
                "Try removing a tag filter or changing the inbox filters",
              )}
            </p>
            <button
              type="button"
              onClick={clearTagFilters}
              className="mt-3 text-sm font-medium text-accent hover:underline"
            >
              {t("chat.clearTagFilters", "Clear tag filters")}
            </button>
          </div>
        )}

        {/* First-run state - no provider account has been linked yet. This is
            also the primary mobile onboarding surface, where the main pane is
            not visible until a conversation is selected. */}
        {!isLoading &&
          !isError &&
          isFirstRun &&
          !searchQuery &&
          selectedTags.length === 0 && (
            <div className="flex h-full flex-col px-5 py-7 text-start sm:px-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-line-strong">
                  <Smartphone
                    className="size-5"
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                    {t("chat.sidebarSetupLabel", "Inbox setup")}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-fg-subtle">
                    {t("chat.oneStepRemaining", "One step remaining")}
                  </p>
                </div>
              </div>

              <h2 className="mt-7 text-xl font-semibold leading-tight tracking-[-0.025em] text-fg">
                {t("chat.sidebarSetupTitle", "Your inbox is almost ready")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">
                {can("can_manage_connections")
                  ? t(
                      "chat.connectChannelsSidebarHint",
                      "Connect WhatsApp or Telegram and conversations will begin appearing here automatically.",
                    )
                  : t(
                      "chat.askAdminToConnectChannelShort",
                      "Ask a workspace owner or admin to connect a channel.",
                    )}
              </p>

              <div className="mt-7 rounded-2xl border border-line bg-subtle p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary shadow-sm">
                    1
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fg">
                      {t(
                        "chat.sidebarConnectChannelStep",
                        "Connect your first channel",
                      )}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-fg-subtle">
                      {t(
                        "chat.sidebarConnectChannelStepHint",
                        "Choose WhatsApp or Telegram to start",
                      )}
                    </p>
                  </div>
                </div>
                <div className="ms-3.5 h-5 border-s border-dashed border-line-strong" />
                <div className="flex items-center gap-3 opacity-55">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs font-semibold text-fg-muted">
                    2
                  </span>
                  <p className="text-xs font-medium text-fg-muted">
                    {t(
                      "chat.sidebarReadyStep",
                      "Chats and groups sync automatically",
                    )}
                  </p>
                </div>
              </div>

              {can("can_manage_connections") && activeWorkspace && (
                <Link
                  to={workspacePath(
                    activeWorkspace.id,
                    "settings",
                    "connections",
                  )}
                  className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:hidden"
                >
                  {t("chat.connectChannels", "Connect channels")}
                  <ArrowRight
                    className="size-4 rtl:-scale-x-100"
                    aria-hidden="true"
                  />
                </Link>
              )}

              <p className="mt-auto hidden border-t border-line pt-5 text-xs leading-5 text-fg-subtle md:block">
                {t(
                  "chat.sidebarContinueHint",
                  "Continue setup in the main panel. It usually takes about a minute.",
                )}
              </p>
            </div>
          )}

        {/* Empty State - No Unread Chats */}
        {isEmpty &&
          !isFirstRun &&
          connectionState !== "loading" &&
          !searchQuery &&
          selectedTags.length === 0 &&
          assignmentFilter === "unread" && (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <svg
                className="w-12 h-12 text-accent mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="text-fg font-medium">
                {t("chat.allCaughtUp", "All caught up!")}
              </p>
              <p className="text-sm text-fg-muted mt-1">
                {t("chat.noUnreadMessages", "You have no unread messages")}
              </p>
            </div>
          )}

        {/* Empty State - No Chats */}
        {isEmpty &&
          !isFirstRun &&
          connectionState !== "loading" &&
          !searchQuery &&
          selectedTags.length === 0 &&
          assignmentFilter !== "unread" && (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <svg
                className="w-12 h-12 text-fg-subtle mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-fg font-medium">
                {t("chat.noConversationsYet", "No conversations yet")}
              </p>
              <p className="text-sm text-fg-muted mt-1">
                {t(
                  "chat.startNewChatHint",
                  "Start a new chat to begin messaging",
                )}
              </p>
            </div>
          )}

        {/* Virtualized Chat List Items */}
        {visibleChats.length > 0 && (
          <VirtualizedChatRows
            key={listScope}
            chats={visibleChats}
            scrollContainerRef={scrollContainerRef}
            scrollElement={scrollElement}
            scrollPositionRef={scrollPositionRef}
            selectedChatId={selectedChatId}
            onChatSelect={handleChatClick}
            onPrefetch={prefetchContact}
            hasPreviousPage={hasPreviousPage}
            showAccount={showRowAccount}
          />
        )}

        <div ref={paginationFooterRef}>
          {(hasNextPage || paginationError) && (
            <div className="flex min-h-12 flex-col items-center justify-center gap-1 px-4 py-3 text-xs text-fg-muted">
              {paginationError && (
                <p role="status">
                  {t("chat.loadMoreFailed", "Could not load more chats")}
                </p>
              )}
              {isFetching ? (
                <span role="status">
                  {t("chat.loadingMore", "Loading more chats…")}
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded px-3 py-1 font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  onClick={() => {
                    if (!paginationError) return loadMore();
                    void (nextPageFailed
                      ? fetchNextPage({ cancelRefetch: false })
                      : previousPageFailed
                        ? fetchPreviousPage({ cancelRefetch: false })
                        : refetchChats());
                  }}
                >
                  {paginationError
                    ? t("common.retry", "Retry")
                    : t("chat.loadMore", "Load more chats")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
