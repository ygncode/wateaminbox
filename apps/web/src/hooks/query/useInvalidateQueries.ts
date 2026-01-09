import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Hook for invalidating a single query key.
 *
 * Provides a memoized invalidation function that can be used in mutation callbacks
 * or as a refresh action without needing to access the query client directly.
 *
 * @example
 * ```ts
 * const invalidateContacts = useInvalidate(queryKeys.contacts.all)
 *
 * // In mutation onSuccess:
 * onSuccess: () => invalidateContacts()
 *
 * // Or as a refresh action:
 * <button onClick={invalidateContacts}>Refresh</button>
 * ```
 */
export function useInvalidate(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    return queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);
}

/**
 * Hook for invalidating multiple query keys at once.
 *
 * Useful when a mutation affects multiple related queries that need to be
 * refreshed together.
 *
 * @example
 * ```ts
 * const invalidate = useInvalidateMultiple([
 *   labelKeys.all,
 *   queryKeys.tags.all,
 * ])
 *
 * // In mutation onSuccess:
 * onSuccess: () => invalidate()
 * ```
 */
export function useInvalidateMultiple(queryKeys: QueryKey[]) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    return Promise.all(
      queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  }, [queryClient, queryKeys]);
}

/**
 * Hook that provides direct access to invalidation utilities.
 *
 * Returns the query client along with helper functions for common invalidation
 * patterns. Use this when you need dynamic query keys or more control over
 * invalidation timing.
 *
 * @example
 * ```ts
 * const { invalidate, invalidateMultiple } = useQueryInvalidation()
 *
 * // Dynamic key invalidation:
 * onSuccess: (data, { contactId }) => {
 *   invalidate(queryKeys.contacts.detail(contactId))
 * }
 *
 * // Multiple dynamic keys:
 * onSuccess: (_, { catalogId }) => {
 *   invalidateMultiple([
 *     catalogKeys.products(catalogId),
 *     catalogKeys.detail(catalogId),
 *   ])
 * }
 * ```
 */
export function useQueryInvalidation() {
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    (queryKey: QueryKey) => {
      return queryClient.invalidateQueries({ queryKey });
    },
    [queryClient],
  );

  const invalidateMultiple = useCallback(
    (queryKeys: QueryKey[]) => {
      return Promise.all(
        queryKeys.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
    [queryClient],
  );

  const invalidateExact = useCallback(
    (queryKey: QueryKey) => {
      return queryClient.invalidateQueries({ queryKey, exact: true });
    },
    [queryClient],
  );

  return {
    queryClient,
    invalidate,
    invalidateMultiple,
    invalidateExact,
  };
}

/**
 * Creates a mutation options object with onSuccess invalidation.
 *
 * Utility function for creating consistent mutation configurations
 * that automatically invalidate specified queries on success.
 *
 * @example
 * ```ts
 * const { queryClient } = useQueryInvalidation()
 *
 * return useMutation({
 *   mutationFn: deleteContact,
 *   ...withInvalidation(queryClient, queryKeys.contacts.all),
 * })
 * ```
 */
export function withInvalidation(
  queryClient: ReturnType<typeof useQueryClient>,
  ...queryKeys: QueryKey[]
) {
  return {
    onSuccess: () => {
      queryKeys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  };
}

/**
 * Creates mutation options with dynamic invalidation based on variables.
 *
 * Use this when the query key to invalidate depends on mutation variables.
 *
 * @example
 * ```ts
 * const { queryClient } = useQueryInvalidation()
 *
 * return useMutation({
 *   mutationFn: updateContact,
 *   ...withDynamicInvalidation(
 *     queryClient,
 *     (_, { contactId }) => [queryKeys.contacts.detail(contactId)]
 *   ),
 * })
 * ```
 */
export function withDynamicInvalidation<TData = unknown, TVariables = void>(
  queryClient: ReturnType<typeof useQueryClient>,
  getQueryKeys: (data: TData, variables: TVariables) => QueryKey[],
) {
  return {
    onSuccess: (data: TData, variables: TVariables) => {
      const keys = getQueryKeys(data, variables);
      keys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  };
}
