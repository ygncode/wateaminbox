import type { ReactElement } from "react";

/**
 * Escape special regex characters in a string
 *
 * @param string - The string to escape
 * @returns The escaped string safe for use in RegExp
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface HighlightedTextProps {
  /** The text to display */
  text: string;
  /** The search query to highlight */
  query: string;
  /** Optional custom class for highlighted matches */
  highlightClassName?: string;
}

/**
 * Highlight matching text in search results
 *
 * Splits the text by the query and wraps matching parts in a <mark> element
 * with appropriate styling for both light and dark modes.
 *
 * @example
 * ```tsx
 * <HighlightedText text="Hello World" query="wor" />
 * // Renders: Hello <mark>Wor</mark>ld
 * ```
 */
export function HighlightedText({
  text,
  query,
  highlightClassName,
}: HighlightedTextProps): ReactElement {
  if (!query.trim() || !text) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  const defaultHighlightClass =
    "bg-yellow-200 dark:bg-yellow-500/30 text-gray-900 dark:text-yellow-200 rounded px-0.5";

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={index}
            className={highlightClassName || defaultHighlightClass}
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

export default HighlightedText;
