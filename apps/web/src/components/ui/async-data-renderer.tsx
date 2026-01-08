import type { ReactNode } from "react";
import { Skeleton } from "./skeleton";

export interface AsyncDataRendererProps<T> {
  /** Whether data is currently loading */
  isLoading: boolean;
  /** Error state - truthy value indicates an error occurred */
  isError?: boolean;
  /** The data to render when available */
  data: T | undefined | null;
  /** Render function for the data - receives the non-null data */
  children: (data: T) => ReactNode;
  /** Custom loading skeleton (defaults to a single line skeleton) */
  skeleton?: ReactNode;
  /** Custom error message (defaults to "Failed to load data") */
  errorMessage?: string;
  /** Custom empty state message (defaults to "No data available") */
  emptyMessage?: string;
  /** Custom error fallback component */
  errorFallback?: ReactNode;
  /** Custom empty fallback component */
  emptyFallback?: ReactNode;
  /** Height for the skeleton placeholder */
  skeletonHeight?: string;
  /** Number of skeleton lines to show */
  skeletonCount?: number;
}

/**
 * A reusable wrapper component for handling async data states (loading, error, empty, success).
 * Reduces boilerplate code for common data fetching patterns.
 *
 * @example
 * ```tsx
 * <AsyncDataRenderer
 *   isLoading={isLoading}
 *   isError={isError}
 *   data={userData}
 *   skeleton={<Skeleton className="h-48 w-full" />}
 * >
 *   {(user) => <UserProfile user={user} />}
 * </AsyncDataRenderer>
 * ```
 */
export function AsyncDataRenderer<T>({
  isLoading,
  isError,
  data,
  children,
  skeleton,
  errorMessage = "Failed to load data",
  emptyMessage = "No data available",
  errorFallback,
  emptyFallback,
  skeletonHeight = "h-6",
  skeletonCount = 1,
}: AsyncDataRendererProps<T>) {
  // Loading state
  if (isLoading) {
    if (skeleton) {
      return <>{skeleton}</>;
    }
    return (
      <div className="space-y-3">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <Skeleton key={i} className={`${skeletonHeight} w-full`} />
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    if (errorFallback) {
      return <>{errorFallback}</>;
    }
    return (
      <p className="text-red-500 dark:text-red-400 text-center py-4">
        {errorMessage}
      </p>
    );
  }

  // Empty/null data state
  if (
    data === undefined ||
    data === null ||
    (Array.isArray(data) && data.length === 0)
  ) {
    if (emptyFallback) {
      return <>{emptyFallback}</>;
    }
    return (
      <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
        {emptyMessage}
      </p>
    );
  }

  // Success state - render children with data
  return <>{children(data)}</>;
}

export default AsyncDataRenderer;
