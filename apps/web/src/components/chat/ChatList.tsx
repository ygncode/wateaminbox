import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Smartphone, Tags, UserPlus, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { type Tag, useTags } from "../../hooks/contact/useContactTags";
import { useDebounce } from "../../hooks/ui";
import {
  type AssignmentFilter,
  type ConversationStatusFilter,
  useChats,
} from "../../hooks/useChats";
import { usePrefetchContact } from "../../hooks/usePrefetch";
import { useWhatsAppConnections } from "../../hooks/useWhatsAppConnections";
import type { ChatListProps } from "../../types/chat";
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
import {
  CONVERSATION_STATUS_OPTIONS,
  readChatListFilters,
  writeChatListFilters,
} from "./chat-list-filters";
import { ChatListItem, ChatListItemSkeleton } from "./ChatListItem";
import { ChatListSearch } from "./ChatListSearch";
import { getConnectionLabel } from "./ConnectionIdentity";
import { useTranslation } from "react-i18next";

// Fixed height for chat list items for virtualization
const CHAT_ITEM_HEIGHT = 76;
const MAX_TAG_FILTERS = 50;

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

  const [searchQuery, setSearchQuery] = useState("");
  // Restored once on mount so a refresh lands back on the view the user left.
  const [restoredFilters] = useState(readChatListFilters);
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>(
    restoredFilters.assignment,
  );
  const [conversationStatusFilter, setConversationStatusFilter] =
    useState<ConversationStatusFilter>(restoredFilters.status);
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [connectionFilter, setConnectionFilter] = useState("all");
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
  const { connections } = useWhatsAppConnections();

  useEffect(() => {
    if (
      connectionFilter !== "all" &&
      !connections.some((connection) => connection.id === connectionFilter)
    ) {
      setConnectionFilter("all");
    }
  }, [connectionFilter, connections]);

  useEffect(() => {
    writeChatListFilters({
      status: conversationStatusFilter,
      assignment: assignmentFilter,
    });
  }, [conversationStatusFilter, assignmentFilter]);

  const {
    data: chats,
    isLoading,
    isError,
    error,
  } = useChats(
    searchQuery,
    true,
    assignmentFilter,
    connectionFilter === "all" ? undefined : connectionFilter,
    conversationStatusFilter,
    selectedTagIds,
  );

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

  // Filter archived chats for main view
  const visibleChats = useMemo(() => {
    return chats?.filter((chat) => !chat.isArchived) ?? [];
  }, [chats]);

  // Memoize getItemKey to prevent unnecessary re-renders
  const getItemKey = useCallback(
    (index: number) => visibleChats[index]?.id || index.toString(),
    [visibleChats],
  );

  // Virtualizer for chat list
  const virtualizer = useVirtualizer({
    count: visibleChats.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => CHAT_ITEM_HEIGHT,
    overscan: 5,
    getItemKey,
  });

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-dark-secondary border-r border-gray-200 dark:border-dark-border ${className}`}
      role="navigation"
      aria-label={t("chat.chatListAria", "Chat list")}
    >
      {/* Search */}
      <div className="px-3 py-2 bg-white dark:bg-dark-secondary border-b border-gray-200 dark:border-dark-border">
        <ChatListSearch
          value={searchQuery}
          onChange={handleSearchChange}
          onClear={handleSearchClear}
        />
      </div>

      {/* Account scope makes the destination number explicit in multi-account inboxes. */}
      {connections.length > 1 && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-dark-border dark:bg-dark-secondary">
          <Smartphone
            className="h-4 w-4 shrink-0 text-gray-400 dark:text-dark-text-tertiary"
            aria-hidden="true"
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-text-secondary">
            {t("chat.inbox", "Inbox")}
          </span>
          <Select value={connectionFilter} onValueChange={setConnectionFilter}>
            <SelectTrigger
              className="ml-auto h-8 min-w-0 max-w-[190px] border-0 bg-gray-100 px-2.5 text-xs shadow-none focus:ring-1 focus:ring-whatsapp-green dark:bg-dark-tertiary"
              aria-label={t(
                "chat.filterByAccount",
                "Filter by WhatsApp account",
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
                  {connection.status !== "connected"
                    ? ` · ${t("chat.offline", "Offline").toLowerCase()}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Conversation lifecycle filters - All leads and is where a first-time
          user starts, then the lifecycle narrows through Open/Pending/Resolved
          (see chat-list-filters.ts). Resolved chats stay browsable. */}
      <div className="flex items-center border-b border-gray-200 bg-gray-50 dark:border-dark-border dark:bg-dark-secondary">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain px-2 py-1.5 [scrollbar-width:thin]"
          aria-label={t("chat.statusFilters", "Conversation status filters")}
          onWheel={handleFilterWheel}
        >
          {CONVERSATION_STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setConversationStatusFilter(option.value)}
              aria-pressed={conversationStatusFilter === option.value}
              className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                conversationStatusFilter === option.value
                  ? "bg-whatsapp-teal-green text-white"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary dark:hover:bg-dark-border"
              }`}
            >
              {t(option.labelKey, option.label)}
            </button>
          ))}
        </div>

        <Popover onOpenChange={(open) => !open && setTagSearch("")}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`mr-1 inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/40 ${
                selectedTags.length > 0
                  ? "border-whatsapp-teal-green/40 bg-whatsapp-teal-green/10 text-whatsapp-teal-green hover:bg-whatsapp-teal-green/15 dark:bg-whatsapp-teal-green/15"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary"
              }`}
              aria-label={
                selectedTags.length > 0
                  ? t("chat.filterByTagSelected", {
                      defaultValue:
                        "Filter conversations by tag, {{count}} selected",
                      count: selectedTags.length,
                    })
                  : t("chat.filterByTag", "Filter conversations by tag")
              }
            >
              <Tags className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t("chat.filter", "Filter")}</span>
              {selectedTags.length > 0 && (
                <span className="grid min-w-4 place-items-center rounded-full bg-whatsapp-teal-green px-1 text-[10px] leading-4 text-white tabular-nums">
                  {selectedTags.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(21rem,calc(100vw-1rem))] overflow-hidden rounded-xl border-gray-200 p-0 shadow-[0_18px_50px_-12px_rgba(15,23,42,0.28)] dark:border-dark-border"
          >
            <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-whatsapp-teal-green/10 text-whatsapp-teal-green dark:bg-whatsapp-teal-green/15">
                <Tags className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-dark-text-primary">
                  {t("chat.filterByTagsTitle", "Filter by tags")}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-dark-text-secondary">
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
              <div className="border-y border-whatsapp-teal-green/15 bg-whatsapp-teal-green/[0.06] px-3 py-2.5 dark:bg-whatsapp-teal-green/10">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-dark-text-secondary">
                    {t("chat.selectedCount", {
                      defaultValue: "Selected · {{count}}",
                      count: selectedTags.length,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={clearTagFilters}
                    className="rounded px-1 py-0.5 text-[11px] font-medium text-whatsapp-teal-green hover:bg-whatsapp-teal-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/40"
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
                      className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 pl-2 pr-1.5 text-xs text-gray-700 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/40 dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-primary dark:hover:border-red-900/60 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                      aria-label={`Remove ${tag.name} tag filter`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-gray-300"
                        style={
                          tag.color ? { backgroundColor: tag.color } : undefined
                        }
                        aria-hidden="true"
                      />
                      <span className="max-w-44 truncate">{tag.name}</span>
                      <X
                        className="h-3 w-3 shrink-0 text-gray-400 group-hover:text-current"
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
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-gray-500 dark:text-dark-text-secondary">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-whatsapp-teal-green dark:border-dark-border dark:border-t-whatsapp-teal-green" />
                  {t("chat.searchingTags", "Searching tags…")}
                </div>
              ) : tagResults.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Tags className="mx-auto mb-2 h-5 w-5 text-gray-300 dark:text-dark-text-tertiary" />
                  <p className="text-xs font-medium text-gray-600 dark:text-dark-text-primary">
                    {debouncedTagSearch
                      ? t("chat.noMatchingTags", "No matching tags")
                      : t("chat.noTagsYet", "No tags yet")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400 dark:text-dark-text-secondary">
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
                      className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors last:mb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-whatsapp-green/40 disabled:cursor-not-allowed disabled:opacity-45 ${
                        selected
                          ? "bg-whatsapp-teal-green/[0.08] text-gray-900 dark:bg-whatsapp-teal-green/10 dark:text-dark-text-primary"
                          : "text-gray-700 hover:bg-gray-50 dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full bg-gray-300 ring-2 ring-white dark:ring-dark-elevated"
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
                            ? "border-whatsapp-teal-green bg-whatsapp-teal-green text-white"
                            : "border-gray-200 bg-white text-transparent dark:border-dark-border dark:bg-dark-tertiary"
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

      {/* Assignment filters remain horizontally reachable at narrow widths. */}
      <div className="flex items-center border-b border-gray-200 bg-gray-50 dark:border-dark-border dark:bg-dark-secondary">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain px-2 py-1.5 [scrollbar-width:thin]"
          aria-label={t("chat.conversationFilters", "Conversation filters")}
          onWheel={handleFilterWheel}
        >
          <button
            type="button"
            onClick={() => setAssignmentFilter("all")}
            className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              assignmentFilter === "all"
                ? "bg-whatsapp-teal-green text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary dark:hover:bg-dark-border"
            }`}
          >
            {t("chat.all", "All")}
          </button>
          <button
            type="button"
            onClick={() => setAssignmentFilter("unread")}
            className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              assignmentFilter === "unread"
                ? "bg-whatsapp-teal-green text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary dark:hover:bg-dark-border"
            }`}
          >
            {t("chat.unread", "Unread")}
          </button>
          <button
            type="button"
            onClick={() => setAssignmentFilter("assignedToMe")}
            className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              assignmentFilter === "assignedToMe"
                ? "bg-whatsapp-teal-green text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary dark:hover:bg-dark-border"
            }`}
          >
            {t("chat.assignedToMe", "Assigned to Me")}
          </button>
          <button
            type="button"
            onClick={() => setAssignmentFilter("unassigned")}
            className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              assignmentFilter === "unassigned"
                ? "bg-whatsapp-teal-green text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary dark:hover:bg-dark-border"
            }`}
          >
            {t("chat.unassigned", "Unassigned")}
          </button>
        </div>

        {/* Keep the primary action visible while the filters scroll. */}
        <button
          type="button"
          onClick={() => setIsAddContactOpen(true)}
          className="mr-1 flex-shrink-0 rounded-full p-1.5 text-whatsapp-teal-green transition-colors hover:bg-whatsapp-teal-green/10 dark:hover:bg-whatsapp-teal-green/20"
          aria-label={t("contacts.addNew", "Add new contact")}
          data-testid="add-contact-button"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Add Contact Dialog */}
      <AddContactDialog
        open={isAddContactOpen}
        onOpenChange={setIsAddContactOpen}
      />

      {/* Chat List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        role="listbox"
        aria-label={t("chat.conversations", "Conversations")}
        aria-live="polite"
        aria-busy={isLoading}
      >
        {/* Loading State */}
        {isLoading && (
          <div className="divide-y divide-gray-100 dark:divide-dark-border">
            {Array.from({ length: 8 }).map((_, index) => (
              <ChatListItemSkeleton key={index} />
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg
              className="w-12 h-12 text-red-400 mb-4"
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
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">
              {t("chat.loadFailed", "Failed to load chats")}
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              {error?.message ||
                t("errors.tryAgainLater", "Please try again later")}
            </p>
          </div>
        )}

        {/* Empty State - No Search Results */}
        {!isLoading && !isError && visibleChats.length === 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg
              className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4"
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
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">
              {t("chat.noChats", "No chats found")}
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              {t("chat.noResultsFor", {
                defaultValue: 'No results for "{{query}}"',
                query: searchQuery,
              })}
            </p>
          </div>
        )}

        {/* Empty State - No conversations match the selected tags */}
        {!isLoading &&
          !isError &&
          visibleChats.length === 0 &&
          !searchQuery &&
          selectedTags.length > 0 && (
            <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
              <Tags className="mb-4 h-11 w-11 text-gray-300 dark:text-dark-text-tertiary" />
              <p className="font-medium text-gray-600 dark:text-dark-text-primary">
                {t(
                  "chat.noTaggedConversations",
                  "No tagged conversations found",
                )}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-dark-text-secondary">
                {t(
                  "chat.noTaggedConversationsHint",
                  "Try removing a tag filter or changing the inbox filters",
                )}
              </p>
              <button
                type="button"
                onClick={clearTagFilters}
                className="mt-3 text-sm font-medium text-whatsapp-teal-green hover:underline"
              >
                {t("chat.clearTagFilters", "Clear tag filters")}
              </button>
            </div>
          )}

        {/* Empty State - No Unread Chats */}
        {!isLoading &&
          !isError &&
          visibleChats.length === 0 &&
          !searchQuery &&
          selectedTags.length === 0 &&
          assignmentFilter === "unread" && (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <svg
                className="w-12 h-12 text-whatsapp-green mb-4"
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
              <p className="text-gray-600 dark:text-dark-text-primary font-medium">
                {t("chat.allCaughtUp", "All caught up!")}
              </p>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
                {t("chat.noUnreadMessages", "You have no unread messages")}
              </p>
            </div>
          )}

        {/* Empty State - No Chats */}
        {!isLoading &&
          !isError &&
          visibleChats.length === 0 &&
          !searchQuery &&
          selectedTags.length === 0 &&
          assignmentFilter !== "unread" && (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <svg
                className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4"
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
              <p className="text-gray-600 dark:text-dark-text-primary font-medium">
                {t("chat.noConversationsYet", "No conversations yet")}
              </p>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
                {t(
                  "chat.startNewChatHint",
                  "Start a new chat to begin messaging",
                )}
              </p>
            </div>
          )}

        {/* Virtualized Chat List Items */}
        {!isLoading && !isError && visibleChats.length > 0 && (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const chat = visibleChats[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ChatListItem
                    chat={chat}
                    isSelected={chat.id === selectedChatId}
                    onClick={() => handleChatClick(chat.id)}
                    onPrefetch={prefetchContact}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatList;
