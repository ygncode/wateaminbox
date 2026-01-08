/**
 * Search Empty State Component
 *
 * Displays appropriate messaging when search has no results or hasn't started.
 */

import { Search } from "lucide-react";

interface EmptyStateProps {
  query: string;
  hasFilters: boolean;
}

/**
 * Empty state for search panel
 */
export function EmptyState({ query, hasFilters }: EmptyStateProps) {
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
