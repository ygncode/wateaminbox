/**
 * URL-backed pagination/filter state for ServerDataTable views.
 *
 * The search params are the single source of truth so a page survives reload
 * and browser navigation. Updates replace the history entry: paging through a
 * table should not have to be undone one step at a time with Back.
 */

import type { PaginationState } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

export interface UseTableParamsOptions {
  /** Search-param name holding the zero-based page index. */
  pageKey?: string;
  /** Search-param name holding the page size. */
  pageSizeKey?: string;
  defaultPageSize?: number;
  /** Sizes the footer offers; anything else in the URL falls back to default. */
  pageSizeOptions?: number[];
}

export interface UseTableParams {
  pagination: PaginationState;
  setPagination: (next: PaginationState) => void;
  /** Read a validated filter param, falling back when the URL holds junk. */
  getParam: (
    key: string,
    allowed: readonly string[],
    fallback: string,
  ) => string;
  /** Set/clear a filter param and return to the first page. */
  setFilterParam: (key: string, value: string) => void;
  /** Drop this table's paging params (e.g. the parent record changed). */
  resetParams: (keys?: string[]) => void;
}

export function useTableParams({
  pageKey = "page",
  pageSizeKey = "pageSize",
  defaultPageSize = 20,
  pageSizeOptions = [10, 20, 50],
}: UseTableParamsOptions = {}): UseTableParams {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawPage = Number(searchParams.get(pageKey));
  const pageIndex =
    Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 0;
  const rawPageSize = Number(searchParams.get(pageSizeKey));
  const pageSize = pageSizeOptions.includes(rawPageSize)
    ? rawPageSize
    : defaultPageSize;

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize],
  );

  const setPagination = useCallback(
    (next: PaginationState) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          const sizeChanged = next.pageSize !== pageSize;
          if (next.pageSize === defaultPageSize) params.delete(pageSizeKey);
          else params.set(pageSizeKey, String(next.pageSize));
          // A different page size invalidates the offset the old page implied.
          const nextPage = sizeChanged ? 0 : Math.max(0, next.pageIndex);
          if (nextPage > 0) params.set(pageKey, String(nextPage));
          else params.delete(pageKey);
          return params;
        },
        { replace: true },
      );
    },
    [defaultPageSize, pageKey, pageSize, pageSizeKey, setSearchParams],
  );

  const getParam = useCallback(
    (key: string, allowed: readonly string[], fallback: string) => {
      const value = searchParams.get(key);
      return value && allowed.includes(value) ? value : fallback;
    },
    [searchParams],
  );

  const setFilterParam = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (value) params.set(key, value);
          else params.delete(key);
          params.delete(pageKey);
          return params;
        },
        { replace: true },
      );
    },
    [pageKey, setSearchParams],
  );

  const resetParams = useCallback(
    (keys: string[] = []) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          for (const key of [pageKey, pageSizeKey, ...keys]) {
            params.delete(key);
          }
          return params;
        },
        { replace: true },
      );
    },
    [pageKey, pageSizeKey, setSearchParams],
  );

  return { pagination, setPagination, getParam, setFilterParam, resetParams };
}
