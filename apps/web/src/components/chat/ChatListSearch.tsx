import { useCallback, useRef } from "react";
import type { ChatListSearchProps } from "../../types/chat";
import { useTranslation } from "react-i18next";

/**
 * Search input component for filtering chat contacts
 * Features search icon, input field, and clear button
 */
export function ChatListSearch({
  value,
  onChange,
  onClear,
  placeholder,
}: ChatListSearchProps) {
  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onClear();
    inputRef.current?.focus();
  }, [onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear],
  );

  return (
    <div className="relative flex items-center w-full">
      {/* Search Icon */}
      <div className="absolute start-3 pointer-events-none">
        <svg
          className="w-4 h-4 text-fg-subtle"
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
      </div>

      {/* Search Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          placeholder ?? t("chat.searchContactsPlaceholder", "Search contacts")
        }
        className="w-full py-2 ps-9 pe-8 text-sm bg-muted border border-line rounded-lg text-fg placeholder-fg-subtle focus:outline-none focus:border-primary focus:ring-1 focus:ring-ring focus:bg-surface transition-all"
        aria-label={t("chat.searchContactsAria", "Search contacts")}
      />

      {/* Clear Button - only visible when there's input */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute end-2 p-1 text-fg-subtle hover:text-fg-muted focus:outline-none transition-colors"
          aria-label={t("common.clearSearch", "Clear search")}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
