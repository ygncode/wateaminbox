import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConversationSearch } from '../../hooks/useSearch'

interface ConversationSearchProps {
  contactId: string
  onClose: () => void
  onNavigateToMessage: (messageId: string) => void
}

export function ConversationSearch({
  contactId,
  onClose,
  onNavigateToMessage,
}: ConversationSearchProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Reset index when results change
  useEffect(() => {
    setCurrentIndex(0)
  }, [])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Search hook
  const { data, isLoading } = useConversationSearch(
    debouncedQuery,
    contactId,
    debouncedQuery.length >= 2
  )

  const results = data?.data || []
  const total = data?.pagination.total || 0

  // Navigate to next/previous result
  const goToNext = useCallback(() => {
    if (results.length === 0) return
    const nextIndex = (currentIndex + 1) % results.length
    setCurrentIndex(nextIndex)
    onNavigateToMessage(results[nextIndex].id)
  }, [currentIndex, results, onNavigateToMessage])

  const goToPrevious = useCallback(() => {
    if (results.length === 0) return
    const prevIndex = currentIndex === 0 ? results.length - 1 : currentIndex - 1
    setCurrentIndex(prevIndex)
    onNavigateToMessage(results[prevIndex].id)
  }, [currentIndex, results, onNavigateToMessage])

  // Navigate to first result when results load
  useEffect(() => {
    if (results.length > 0 && currentIndex === 0) {
      onNavigateToMessage(results[0].id)
    }
  }, [results, currentIndex, onNavigateToMessage])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          goToPrevious()
        } else {
          goToNext()
        }
        e.preventDefault()
      } else if (e.key === 'ArrowUp') {
        goToPrevious()
        e.preventDefault()
      } else if (e.key === 'ArrowDown') {
        goToNext()
        e.preventDefault()
      }
    },
    [onClose, goToNext, goToPrevious]
  )

  const handleClear = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-dark-secondary border-b border-gray-200 dark:border-dark-border">
      {/* Search input */}
      <div className="flex-1 flex items-center gap-2 bg-white dark:bg-dark-tertiary rounded-lg px-3 py-1.5 border border-gray-200 dark:border-dark-border focus-within:border-whatsapp-teal-green focus-within:ring-1 focus-within:ring-whatsapp-teal-green">
        <Search className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search in conversation..."
          className="flex-1 bg-transparent text-sm outline-none text-gray-900 dark:text-dark-text-primary placeholder:text-gray-400 dark:placeholder:text-dark-text-tertiary"
          aria-label="Search messages in conversation"
        />
        {isLoading && (
          <Loader2 className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary animate-spin flex-shrink-0" />
        )}
        {query && !isLoading && (
          <button
            onClick={handleClear}
            className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-dark-text-tertiary dark:hover:text-dark-text-secondary rounded"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Results counter and navigation */}
      {debouncedQuery.length >= 2 && (
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-500 dark:text-dark-text-secondary min-w-[60px] text-center">
            {results.length > 0 ? (
              <>
                {currentIndex + 1} of {total}
              </>
            ) : isLoading ? (
              '...'
            ) : (
              'No results'
            )}
          </span>

          {/* Navigation buttons */}
          <button
            onClick={goToPrevious}
            disabled={results.length === 0}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:text-dark-text-secondary dark:hover:text-dark-text-primary dark:hover:bg-dark-tertiary rounded disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Previous result"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={goToNext}
            disabled={results.length === 0}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:text-dark-text-secondary dark:hover:text-dark-text-primary dark:hover:bg-dark-tertiary rounded disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Next result"
            title="Next (Enter)"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:text-dark-text-secondary dark:hover:text-dark-text-primary dark:hover:bg-dark-tertiary rounded"
        aria-label="Close search"
        title="Close (Escape)"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

export default ConversationSearch
