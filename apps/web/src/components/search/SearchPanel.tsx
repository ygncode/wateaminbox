import {
  ChevronDown,
  ChevronUp,
  FileText,
  Filter,
  Image,
  MapPin,
  MessageSquare,
  Music,
  Search,
  User,
  Users,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatChatListTime,
  subtractDays,
  toISOString,
  now,
} from "@whatsapp-web/shared";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui";
import {
  type ContactSearchResult,
  type MessageSearchOptions,
  type MessageSearchResult,
  useContactSearch,
  useGlobalSearch,
  useMessageSearch,
} from "@/hooks/useSearch";

type SearchTab = "all" | "messages" | "contacts";

type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "location";

interface SearchPanelProps {
  /** Callback when a message result is clicked */
  onMessageClick?: (contactId: string, messageId: string) => void;
  /** Callback when a contact result is clicked */
  onContactClick?: (contactId: string) => void;
  /** Callback to close the search panel */
  onClose?: () => void;
  /** Additional class names */
  className?: string;
}

/**
 * Debounce hook for search input
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Highlight matching text in search results
 */
function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.ReactElement {
  if (!query.trim() || !text) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={index}
            className="bg-yellow-200 dark:bg-yellow-500/30 text-gray-900 dark:text-yellow-200 rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

/**
 * Message search result item component
 */
function MessageResultItem({
  result,
  query,
  onClick,
}: {
  result: MessageSearchResult;
  query: string;
  onClick: () => void;
}) {
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

/**
 * Contact search result item component
 */
function ContactResultItem({
  result,
  query,
  onClick,
}: {
  result: ContactSearchResult;
  query: string;
  onClick: () => void;
}) {
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

/**
 * Loading skeleton for search results
 */
function SearchResultSkeleton() {
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
 * Message filters component
 */
function MessageFilters({
  dateRange,
  onDateRangeChange,
  selectedTypes,
  onTypesChange,
  expanded,
  onToggle,
}: {
  dateRange: "7d" | "30d" | "90d" | "all";
  onDateRangeChange: (range: "7d" | "30d" | "90d" | "all") => void;
  selectedTypes: MessageType[];
  onTypesChange: (types: MessageType[]) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const messageTypes: {
    value: MessageType;
    label: string;
    icon: React.ReactElement;
  }[] = [
    {
      value: "text",
      label: "Text",
      icon: <MessageSquare className="w-3 h-3" />,
    },
    { value: "image", label: "Images", icon: <Image className="w-3 h-3" /> },
    { value: "video", label: "Videos", icon: <Video className="w-3 h-3" /> },
    { value: "audio", label: "Audio", icon: <Music className="w-3 h-3" /> },
    {
      value: "document",
      label: "Documents",
      icon: <FileText className="w-3 h-3" />,
    },
    {
      value: "location",
      label: "Location",
      icon: <MapPin className="w-3 h-3" />,
    },
  ];

  const toggleType = (type: MessageType) => {
    if (selectedTypes.includes(type)) {
      onTypesChange(selectedTypes.filter((t) => t !== type));
    } else {
      onTypesChange([...selectedTypes, type]);
    }
  };

  return (
    <div className="border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-secondary">
      {/* Filter Toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" />
          <span>Filters</span>
          {(dateRange !== "all" || selectedTypes.length > 0) && (
            <Badge variant="default" className="text-xs">
              {(dateRange !== "all" ? 1 : 0) +
                (selectedTypes.length > 0 ? 1 : 0)}
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Expanded Filters */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Date Range */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">Date Range</Label>
            <Select value={dateRange} onValueChange={onDateRangeChange}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Message Types */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">Message Types</Label>
            <div className="flex flex-wrap gap-1.5">
              {messageTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => toggleType(type.value)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors ${
                    selectedTypes.includes(type.value)
                      ? "bg-whatsapp-teal-green text-white border-whatsapp-teal-green"
                      : "bg-white dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary border-gray-300 dark:border-dark-border hover:border-gray-400 dark:hover:border-dark-text-tertiary"
                  }`}
                >
                  {type.icon}
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state component
 */
function EmptyState({
  query,
  hasFilters,
}: {
  query: string;
  hasFilters: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <Search className="w-12 h-12 text-gray-300 dark:text-dark-text-tertiary mb-4" />
      {query.length < 2 ? (
        <>
          <p className="text-gray-600 dark:text-dark-text-primary font-medium">
            Start searching
          </p>
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
            Enter at least 2 characters to search
          </p>
        </>
      ) : (
        <>
          <p className="text-gray-600 dark:text-dark-text-primary font-medium">
            No results found
          </p>
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
            No matches for "{query}"
            {hasFilters && ". Try adjusting your filters."}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * SearchPanel component for global search across messages and contacts
 */
export function SearchPanel({
  onMessageClick,
  onContactClick,
  onClose,
  className = "",
}: SearchPanelProps) {
  // Search state
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("all");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Message filter state
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">(
    "all",
  );
  const [selectedMessageTypes, setSelectedMessageTypes] = useState<
    MessageType[]
  >([]);

  // Debounced query
  const debouncedQuery = useDebounce(query, 300);

  // Calculate date range for API
  const dateFilters = useMemo(() => {
    if (dateRange === "all") return {};
    const end = now();
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    const start = subtractDays(end, days);
    return { startDate: toISOString(start), endDate: toISOString(end) };
  }, [dateRange]);

  // Search options for message search
  const messageSearchOptions: MessageSearchOptions = useMemo(
    () => ({
      ...dateFilters,
      messageTypes:
        selectedMessageTypes.length > 0 ? selectedMessageTypes : undefined,
      limit: 50,
    }),
    [dateFilters, selectedMessageTypes],
  );

  // Search queries
  const globalSearch = useGlobalSearch(debouncedQuery, activeTab === "all");
  const messageSearch = useMessageSearch(
    debouncedQuery,
    messageSearchOptions,
    activeTab === "messages",
  );
  const contactSearch = useContactSearch(
    debouncedQuery,
    true,
    activeTab === "contacts",
  );

  // Loading state
  const isLoading =
    (activeTab === "all" && globalSearch.isLoading) ||
    (activeTab === "messages" && messageSearch.isLoading) ||
    (activeTab === "contacts" && contactSearch.isLoading);

  // Results
  const messages = useMemo(() => {
    if (activeTab === "all") {
      return globalSearch.data?.messages ?? [];
    }
    return messageSearch.data?.data ?? [];
  }, [activeTab, globalSearch.data, messageSearch.data]);

  const contacts = useMemo(() => {
    if (activeTab === "all") {
      return globalSearch.data?.contacts ?? [];
    }
    return contactSearch.data?.data ?? [];
  }, [activeTab, globalSearch.data, contactSearch.data]);

  // Has filters applied
  const hasFilters = dateRange !== "all" || selectedMessageTypes.length > 0;

  // Event handlers
  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    [],
  );

  const handleClearQuery = useCallback(() => {
    setQuery("");
  }, []);

  const handleMessageResultClick = useCallback(
    (contactId: string, messageId: string | null) => {
      if (messageId) {
        onMessageClick?.(contactId, messageId);
      } else {
        onContactClick?.(contactId);
      }
    },
    [onMessageClick, onContactClick],
  );

  const handleContactResultClick = useCallback(
    (contactId: string) => {
      onContactClick?.(contactId);
    },
    [onContactClick],
  );

  const handleTabChange = useCallback((tab: SearchTab) => {
    setActiveTab(tab);
    // Reset filters when switching tabs
    if (tab !== "messages") {
      setFiltersExpanded(false);
    }
  }, []);

  const tabs: { value: SearchTab; label: string; icon: React.ReactElement }[] =
    [
      { value: "all", label: "All", icon: <Search className="w-4 h-4" /> },
      {
        value: "messages",
        label: "Messages",
        icon: <MessageSquare className="w-4 h-4" />,
      },
      {
        value: "contacts",
        label: "Contacts",
        icon: <User className="w-4 h-4" />,
      },
    ];

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-dark-secondary ${className}`}
      role="search"
      aria-label="Search panel"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-100 dark:bg-dark-elevated border-b border-gray-200 dark:border-dark-border">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text-primary flex-1">
          Search
        </h2>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close search"
          >
            <X className="w-5 h-5" />
          </Button>
        )}
      </div>

      {/* Search Input */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-dark-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
          <Input
            type="text"
            placeholder="Search messages and contacts..."
            value={query}
            onChange={handleQueryChange}
            className="pl-9 pr-9"
            aria-label="Search query"
          />
          {query && (
            <button
              type="button"
              onClick={handleClearQuery}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-dark-border">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleTabChange(tab.value)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? "text-whatsapp-green border-b-2 border-whatsapp-green bg-whatsapp-green/5 dark:bg-whatsapp-green/10"
                : "text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary"
            }`}
            aria-selected={activeTab === tab.value}
            role="tab"
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Filters (Messages tab only) */}
      {activeTab === "messages" && (
        <MessageFilters
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          selectedTypes={selectedMessageTypes}
          onTypesChange={setSelectedMessageTypes}
          expanded={filtersExpanded}
          onToggle={() => setFiltersExpanded(!filtersExpanded)}
        />
      )}

      {/* Results */}
      <ScrollArea className="flex-1">
        {/* Loading State */}
        {isLoading && (
          <div className="divide-y divide-gray-100 dark:divide-dark-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <SearchResultSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading &&
          debouncedQuery.length >= 2 &&
          messages.length === 0 &&
          contacts.length === 0 && (
            <EmptyState query={debouncedQuery} hasFilters={hasFilters} />
          )}

        {/* No Query State */}
        {!isLoading && debouncedQuery.length < 2 && (
          <EmptyState query={debouncedQuery} hasFilters={false} />
        )}

        {/* Results */}
        {!isLoading && debouncedQuery.length >= 2 && (
          <div>
            {/* All Tab - Show both sections */}
            {activeTab === "all" && (
              <>
                {/* Contacts Section */}
                {contacts.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-gray-50 dark:bg-dark-tertiary border-b border-gray-200 dark:border-dark-border">
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-dark-text-tertiary uppercase tracking-wider">
                        Contacts ({contacts.length})
                      </h3>
                    </div>
                    {contacts.slice(0, 5).map((contact) => (
                      <ContactResultItem
                        key={contact.id}
                        result={contact}
                        query={debouncedQuery}
                        onClick={() => handleContactResultClick(contact.id)}
                      />
                    ))}
                    {contacts.length > 5 && (
                      <button
                        type="button"
                        onClick={() => handleTabChange("contacts")}
                        className="w-full px-4 py-2 text-sm text-whatsapp-green hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors text-center"
                      >
                        View all {contacts.length} contacts
                      </button>
                    )}
                  </div>
                )}

                {/* Messages Section */}
                {messages.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-gray-50 dark:bg-dark-tertiary border-b border-gray-200 dark:border-dark-border">
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-dark-text-tertiary uppercase tracking-wider">
                        Messages ({messages.length})
                      </h3>
                    </div>
                    {messages.slice(0, 10).map((message) => (
                      <MessageResultItem
                        key={message.id}
                        result={message}
                        query={debouncedQuery}
                        onClick={() =>
                          handleMessageResultClick(
                            message.contactId,
                            message.messageId,
                          )
                        }
                      />
                    ))}
                    {messages.length > 10 && (
                      <button
                        type="button"
                        onClick={() => handleTabChange("messages")}
                        className="w-full px-4 py-2 text-sm text-whatsapp-green hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors text-center"
                      >
                        View all {messages.length} messages
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Messages Tab */}
            {activeTab === "messages" && messages.length > 0 && (
              <div>
                {messages.map((message) => (
                  <MessageResultItem
                    key={message.id}
                    result={message}
                    query={debouncedQuery}
                    onClick={() =>
                      handleMessageResultClick(
                        message.contactId,
                        message.messageId,
                      )
                    }
                  />
                ))}
                {messageSearch.data?.pagination?.hasMore && (
                  <div className="px-4 py-3 text-center text-sm text-gray-500 dark:text-dark-text-secondary">
                    Showing {messages.length} of{" "}
                    {messageSearch.data.pagination.total} results
                  </div>
                )}
              </div>
            )}

            {/* Contacts Tab */}
            {activeTab === "contacts" && contacts.length > 0 && (
              <div>
                {contacts.map((contact) => (
                  <ContactResultItem
                    key={contact.id}
                    result={contact}
                    query={debouncedQuery}
                    onClick={() => handleContactResultClick(contact.id)}
                  />
                ))}
                {contactSearch.data?.pagination?.hasMore && (
                  <div className="px-4 py-3 text-center text-sm text-gray-500 dark:text-dark-text-secondary">
                    Showing {contacts.length} of{" "}
                    {contactSearch.data.pagination.total} results
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default SearchPanel;
