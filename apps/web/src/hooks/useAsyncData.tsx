import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Async data state returned by useAsyncData hook
 */
export interface AsyncDataState<T> {
  /** The data returned by the query */
  data: T | undefined;
  /** Whether the query is loading */
  isLoading: boolean;
  /** Whether the query has errored */
  isError: boolean;
  /** The error object if the query has errored */
  error: Error | null;
  /** Whether the data is empty (null, undefined, or empty array) */
  isEmpty: boolean;
  /** Whether the data is available and not empty */
  hasData: boolean;
  /**
   * Render state helper function that returns the appropriate ReactNode
   * based on the current state of the query
   */
  renderState: (options: RenderStateOptions<T>) => ReactNode;
}

/**
 * Options for the renderState helper function
 */
export interface RenderStateOptions<T> {
  /** Render function for loading state */
  loading?: () => ReactNode;
  /** Render function for error state */
  error?: (error: Error | null) => ReactNode;
  /** Render function for empty state (data is null, undefined, or empty array) */
  empty?: () => ReactNode;
  /** Render function for success state with data */
  success: (data: T) => ReactNode;
}

/**
 * Check if data is considered "empty"
 * - undefined or null
 * - Empty array
 * - Object with length property that equals 0
 */
function isDataEmpty<T>(data: T | undefined): boolean {
  if (data === undefined || data === null) {
    return true;
  }
  if (Array.isArray(data) && data.length === 0) {
    return true;
  }
  if (
    typeof data === "object" &&
    "length" in data &&
    (data as { length: number }).length === 0
  ) {
    return true;
  }
  return false;
}

/**
 * Default loading renderer
 */
const defaultLoadingRenderer = () => null;

/**
 * Default error renderer
 */
const defaultErrorRenderer = (error: Error | null) => {
  const message = error?.message ?? "An error occurred";
  return (
    <p className="text-red-500 dark:text-red-400 text-center py-4">{message}</p>
  );
};

/**
 * Default empty renderer
 */
const defaultEmptyRenderer = () => {
  return (
    <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
      No data available
    </p>
  );
};

/**
 * Utility hook that wraps TanStack Query result handling with built-in
 * error/loading/empty states and a renderState() helper function.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { data: userData, isLoading, isError, renderState } = useAsyncData(useUser(userId))
 *
 * // With renderState helper
 * return renderState({
 *   loading: () => <Skeleton />,
 *   error: (error) => <ErrorMessage error={error} />,
 *   empty: () => <EmptyState />,
 *   success: (user) => <UserProfile user={user} />,
 * })
 *
 * // Check states manually
 * if (isLoading) return <Spinner />
 * if (isError) return <Error />
 * if (isEmpty) return <Empty />
 * if (hasData) return <Data data={data} />
 * ```
 *
 * @param queryResult - The result from a TanStack Query hook (useQuery, useSuspenseQuery, etc.)
 * @returns An AsyncDataState object with data, state flags, and renderState helper
 */
export function useAsyncData<T>(
  queryResult: UseQueryResult<T>,
): AsyncDataState<T> {
  const { data, isLoading, isError, error } = queryResult;

  const isEmpty = isDataEmpty(data);
  const hasData = !isLoading && !isError && !isEmpty && data !== undefined;

  const renderState = (options: RenderStateOptions<T>): ReactNode => {
    const {
      loading = defaultLoadingRenderer,
      error: errorRenderer = defaultErrorRenderer,
      empty = defaultEmptyRenderer,
      success,
    } = options;

    if (isLoading) {
      return loading();
    }

    if (isError) {
      return errorRenderer(error ?? null);
    }

    if (isEmpty || data === undefined) {
      return empty();
    }

    return success(data);
  };

  return {
    data,
    isLoading,
    isError,
    error: error ?? null,
    isEmpty,
    hasData,
    renderState,
  };
}

/**
 * Combine multiple async data states into a single state.
 * Useful when you need to wait for multiple queries to complete.
 *
 * @example
 * ```tsx
 * const userData = useAsyncData(useUser(userId))
 * const postsData = useAsyncData(usePosts(userId))
 *
 * const combined = combineAsyncData([userData, postsData])
 *
 * if (combined.isLoading) return <Spinner />
 * if (combined.isError) return <Error />
 * // All data is now available
 * ```
 */
export function combineAsyncData(states: AsyncDataState<unknown>[]): {
  isLoading: boolean;
  isError: boolean;
  errors: (Error | null)[];
  allHaveData: boolean;
} {
  return {
    isLoading: states.some((s) => s.isLoading),
    isError: states.some((s) => s.isError),
    errors: states.map((s) => s.error),
    allHaveData: states.every((s) => s.hasData),
  };
}
