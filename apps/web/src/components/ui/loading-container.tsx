import * as React from "react";
import { cn } from "@/lib/utils";
import { LoadingSpinner, type LoadingSpinnerProps } from "./loading-spinner";
import { useTranslation } from "react-i18next";

export interface LoadingContainerProps {
  /** Whether the content is currently loading */
  isLoading: boolean;
  /** Content to render when not loading */
  children: React.ReactNode;
  /** Additional CSS class names for the container */
  className?: string;
  /** Size of the loading spinner */
  spinnerSize?: LoadingSpinnerProps["size"];
  /** Custom loading text for screen readers (default: "Loading…") */
  loadingText?: string;
  /** Whether to show the spinner centered in the container */
  centered?: boolean;
  /** Minimum height to maintain when loading (prevents layout shift) */
  minHeight?: string | number;
  /** Custom spinner className */
  spinnerClassName?: string;
}

/**
 * Loading container component with accessibility support
 *
 * Wraps content and displays a loading spinner when `isLoading` is true.
 * Properly announces loading state to screen readers via aria-busy.
 *
 * @example
 * // Basic usage
 * <LoadingContainer isLoading={isPending}>
 *   <ContentList items={items} />
 * </LoadingContainer>
 *
 * @example
 * // With custom loading text
 * <LoadingContainer
 *   isLoading={isFetching}
 *   loadingText="Fetching messages…"
 *   spinnerSize="lg"
 * >
 *   <MessageThread messages={messages} />
 * </LoadingContainer>
 */
export function LoadingContainer({
  isLoading,
  children,
  className,
  spinnerSize = "md",
  loadingText,
  centered = true,
  minHeight,
  spinnerClassName,
}: LoadingContainerProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn("relative", className)}
      aria-busy={isLoading}
      aria-live="polite"
      style={minHeight ? { minHeight } : undefined}
    >
      {isLoading ? (
        <div
          className={cn(
            "flex items-center justify-center",
            centered && "absolute inset-0",
          )}
          role="status"
        >
          <LoadingSpinner size={spinnerSize} className={spinnerClassName} />
          <span className="sr-only">
            {loadingText ?? t("common.loading", "Loading…")}
          </span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

LoadingContainer.displayName = "LoadingContainer";

// ============================================================================
// LoadingOverlay - Shows spinner over existing content
// ============================================================================

export interface LoadingOverlayProps {
  /** Whether to show the loading overlay */
  isLoading: boolean;
  /** Content underneath the overlay */
  children: React.ReactNode;
  /** Additional CSS class names for the container */
  className?: string;
  /** Size of the loading spinner */
  spinnerSize?: LoadingSpinnerProps["size"];
  /** Custom loading text for screen readers */
  loadingText?: string;
  /** Opacity of the overlay background (0-100) */
  overlayOpacity?: number;
}

/**
 * Loading overlay component
 *
 * Displays a semi-transparent overlay with spinner over existing content.
 * Useful for indicating updates to existing data without hiding content.
 *
 * @example
 * <LoadingOverlay isLoading={isRefetching}>
 *   <DataTable rows={rows} />
 * </LoadingOverlay>
 */
export function LoadingOverlay({
  isLoading,
  children,
  className,
  spinnerSize = "md",
  loadingText,
  overlayOpacity = 60,
}: LoadingOverlayProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn("relative", className)}
      aria-busy={isLoading}
      aria-live="polite"
    >
      {children}
      {isLoading && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "bg-white dark:bg-dark-primary",
            "transition-opacity duration-200",
          )}
          style={{ opacity: overlayOpacity / 100 }}
          role="status"
        >
          <LoadingSpinner size={spinnerSize} />
          <span className="sr-only">
            {loadingText ?? t("common.updating", "Updating…")}
          </span>
        </div>
      )}
    </div>
  );
}

LoadingOverlay.displayName = "LoadingOverlay";

// ============================================================================
// InlineLoading - Inline loading indicator
// ============================================================================

export interface InlineLoadingProps {
  /** Size of the spinner */
  size?: LoadingSpinnerProps["size"];
  /** Custom loading text for screen readers */
  loadingText?: string;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Inline loading indicator with screen reader support
 *
 * A simple inline loading indicator with proper accessibility attributes.
 * Use within buttons, table cells, or inline with text.
 *
 * @example
 * <button disabled={isPending}>
 *   {isPending ? <InlineLoading size="xs" /> : "Save"}
 * </button>
 */
export function InlineLoading({
  size = "sm",
  loadingText,
  className,
}: InlineLoadingProps) {
  const { t } = useTranslation();

  return (
    <span
      className={cn("inline-flex items-center", className)}
      role="status"
      aria-live="polite"
    >
      <LoadingSpinner size={size} />
      <span className="sr-only">
        {loadingText ?? t("common.loading", "Loading…")}
      </span>
    </span>
  );
}

InlineLoading.displayName = "InlineLoading";
