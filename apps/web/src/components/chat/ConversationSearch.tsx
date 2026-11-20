import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConversationSearch } from "../../hooks/useSearch";
import { useTranslation } from "react-i18next";

interface ConversationSearchProps {
  contactId?: string;
  conversationId?: string;
  onClose: () => void;
  onNavigateToMessage: (messageId: string) => void;
}

export function ConversationSearch({
  contactId,
  conversationId,
  onClose,
  onNavigateToMessage,
}: ConversationSearchProps) {
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset index when results change
  useEffect(() => {
    setCurrentIndex(0);
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search hook
  const { data, isLoading } = useConversationSearch(
    debouncedQuery,
    { contactId, conversationId },
    debouncedQuery.length >= 2,
  );

  const results = data?.data || [];
  const total = data?.pagination.total || 0;

  // Navigate to next/previous result
  const goToNext = useCallback(() => {
    if (results.length === 0) return;
    const nextIndex = (currentIndex + 1) % results.length;
    setCurrentIndex(nextIndex);
    onNavigateToMessage(results[nextIndex].id);
  }, [currentIndex, results, onNavigateToMessage]);

  const goToPrevious = useCallback(() => {
    if (results.length === 0) return;
    const prevIndex =
      currentIndex === 0 ? results.length - 1 : currentIndex - 1;
    setCurrentIndex(prevIndex);
    onNavigateToMessage(results[prevIndex].id);
  }, [currentIndex, results, onNavigateToMessage]);

  // Navigate to first result when results load
  useEffect(() => {
    if (results.length > 0 && currentIndex === 0) {
      onNavigateToMessage(results[0].id);
    }
  }, [results, currentIndex, onNavigateToMessage]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        if (e.shiftKey) {
          goToPrevious();
        } else {
          goToNext();
        }
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        goToPrevious();
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        goToNext();
        e.preventDefault();
      }
    },
    [onClose, goToNext, goToPrevious],
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2 px-3 py-2 bg-muted border-b border-line">
      {/* Search input */}
      <div className="flex-1 flex items-center gap-2 bg-surface rounded-lg px-3 py-1.5 border border-line focus-within:border-primary focus-within:ring-1 focus-within:ring-ring">
        <Search className="h-4 w-4 text-fg-subtle flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("search.inConversation", "Search in conversation…")}
          className="flex-1 bg-transparent text-sm outline-none text-fg placeholder:text-fg-subtle"
          aria-label={t(
            "search.inConversationAria",
            "Search messages in conversation",
          )}
        />
        {isLoading && (
          <Loader2 className="h-4 w-4 text-fg-subtle animate-spin flex-shrink-0" />
        )}
        {query && !isLoading && (
          <button
            onClick={handleClear}
            className="p-0.5 text-fg-subtle hover:text-fg-muted rounded"
            aria-label={t("common.clearSearch", "Clear search")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Results counter and navigation */}
      {debouncedQuery.length >= 2 && (
        <div className="flex items-center gap-1">
          <span className="text-sm text-fg-muted min-w-[60px] text-center">
            {results.length > 0
              ? t("search.resultPosition", {
                  defaultValue: "{{current}} of {{total}}",
                  current: currentIndex + 1,
                  total,
                })
              : isLoading
                ? "…"
                : t("search.noResultsShort", "No results")}
          </span>

          {/* Navigation buttons */}
          <button
            onClick={goToPrevious}
            disabled={results.length === 0}
            className="p-1.5 text-fg-muted hover:text-fg hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t("search.previousResult", "Previous result")}
            title={t("search.previousResultHint", "Previous (Shift+Enter)")}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={goToNext}
            disabled={results.length === 0}
            className="p-1.5 text-fg-muted hover:text-fg hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t("search.nextResult", "Next result")}
            title={t("search.nextResultHint", "Next (Enter)")}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-muted rounded"
        aria-label={t("search.closeSearch", "Close search")}
        title={t("search.closeSearchHint", "Close (Escape)")}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
