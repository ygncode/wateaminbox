/**
 * SearchPanel Component
 *
 * Global search panel for searching across messages and contacts.
 * Uses sub-components for modular organization.
 */

import { Search, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { now, subtractDays, toISOString } from "@whatsapp-web/shared";
import { Button, Input, ScrollArea } from "@/components/ui";
import {
  type MessageSearchOptions,
  useContactSearch,
  useGlobalSearch,
  useMessageSearch,
} from "@/hooks/useSearch";
import { useDebounce } from "@/hooks/ui";

// Sub-components
import { ContactSearchResults } from "./ContactSearchResults";
import { EmptyState } from "./EmptyState";
import {
  MessageSearchResults,
  SearchResultSkeletons,
} from "./MessageSearchResults";
import { SearchFilters } from "./SearchFilters";
import { SearchTabs } from "./SearchTabs";
import type { DateRange, MessageType, SearchTab } from "./types";

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
  const [dateRange, setDateRange] = useState<DateRange>("all");
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
      <SearchTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Filters (Messages tab only) */}
      {activeTab === "messages" && (
        <SearchFilters
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
        {isLoading && <SearchResultSkeletons count={6} />}

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
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-dark-text-tertiary uppercase">
                        Contacts ({contacts.length})
                      </h3>
                    </div>
                    <ContactSearchResults
                      contacts={contacts}
                      query={debouncedQuery}
                      onContactClick={handleContactResultClick}
                      limit={5}
                      onViewAll={() => handleTabChange("contacts")}
                    />
                  </div>
                )}

                {/* Messages Section */}
                {messages.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-gray-50 dark:bg-dark-tertiary border-b border-gray-200 dark:border-dark-border">
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-dark-text-tertiary uppercase">
                        Messages ({messages.length})
                      </h3>
                    </div>
                    <MessageSearchResults
                      messages={messages}
                      query={debouncedQuery}
                      onMessageClick={handleMessageResultClick}
                      limit={10}
                      onViewAll={() => handleTabChange("messages")}
                    />
                  </div>
                )}
              </>
            )}

            {/* Messages Tab */}
            {activeTab === "messages" && messages.length > 0 && (
              <MessageSearchResults
                messages={messages}
                query={debouncedQuery}
                onMessageClick={handleMessageResultClick}
                hasMore={messageSearch.data?.pagination?.hasMore}
                total={messageSearch.data?.pagination?.total}
              />
            )}

            {/* Contacts Tab */}
            {activeTab === "contacts" && contacts.length > 0 && (
              <ContactSearchResults
                contacts={contacts}
                query={debouncedQuery}
                onContactClick={handleContactResultClick}
                hasMore={contactSearch.data?.pagination?.hasMore}
                total={contactSearch.data?.pagination?.total}
              />
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default SearchPanel;
