import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type PaginationState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  X,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Skeleton } from "./skeleton";

export interface ServerTableSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  debounceMs?: number;
}

export interface ServerDataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  rowCount: number;
  pagination: PaginationState;
  onPaginationChange: (pagination: PaginationState) => void;
  search?: ServerTableSearch;
  toolbarLeading?: ReactNode;
  toolbarActions?: ReactNode;
  toolbarPanel?: ReactNode;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: Error | null;
  getRowId?: (row: TData) => string;
  renderSubRow?: (row: TData) => ReactNode;
  tableLabel: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  tableClassName?: string;
  pageSizeOptions?: number[];
  density?: "default" | "compact";
}

export function getVisibleRowRange(
  rowCount: number,
  pagination: PaginationState,
  visibleRows: number,
): { start: number; end: number } {
  if (rowCount === 0 || visibleRows === 0) return { start: 0, end: 0 };
  const start = pagination.pageIndex * pagination.pageSize + 1;
  return {
    start,
    end: Math.min(start + visibleRows - 1, rowCount),
  };
}

/**
 * Reusable server-driven dashboard table. Its toolbar, table viewport, and
 * pagination footer form one bounded block; only the row viewport scrolls.
 */
export function ServerDataTable<TData>({
  columns,
  data,
  rowCount,
  pagination,
  onPaginationChange,
  search,
  toolbarLeading,
  toolbarActions,
  toolbarPanel,
  isLoading = false,
  isFetching = false,
  error,
  getRowId,
  renderSubRow,
  tableLabel,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Try adjusting your search or filters.",
  className,
  tableClassName,
  pageSizeOptions = [10, 20, 50],
  density = "default",
}: ServerDataTableProps<TData>) {
  const searchId = useId();
  const [searchDraft, setSearchDraft] = useState(search?.value ?? "");
  const searchValue = search?.value ?? "";
  const onSearchChange = search?.onChange;
  const searchDebounceMs = search?.debounceMs ?? 300;
  const pageCount = Math.max(1, Math.ceil(rowCount / pagination.pageSize));
  const visibleRange = getVisibleRowRange(rowCount, pagination, data.length);

  useEffect(() => {
    setSearchDraft(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (!onSearchChange || searchDraft === searchValue) return;
    const timeout = window.setTimeout(
      () => onSearchChange(searchDraft),
      searchDebounceMs,
    );
    return () => window.clearTimeout(timeout);
  }, [onSearchChange, searchDebounceMs, searchDraft, searchValue]);

  useEffect(() => {
    if (rowCount > 0 && pagination.pageIndex >= pageCount) {
      onPaginationChange({
        ...pagination,
        pageIndex: pageCount - 1,
      });
    }
  }, [onPaginationChange, pageCount, pagination, rowCount]);

  const table = useReactTable({
    data,
    columns,
    rowCount,
    pageCount,
    state: { pagination },
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    onPaginationChange: (updater) => {
      onPaginationChange(
        typeof updater === "function" ? updater(pagination) : updater,
      );
    },
  });

  return (
    <section
      className={cn(
        "relative flex h-full min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-[#d7e0da] bg-white shadow-[0_12px_34px_rgba(16,33,27,0.07)] dark:border-dark-border dark:bg-dark-elevated dark:shadow-none",
        className,
      )}
      aria-busy={isFetching}
    >
      {isFetching && !isLoading && (
        <div className="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-[#dcefe7] dark:bg-emerald-950">
          <div className="h-full w-1/3 animate-pulse bg-[#0b7a55]" />
        </div>
      )}

      {(search || toolbarLeading || toolbarActions) && (
        <div
          className={cn(
            "flex shrink-0 flex-col gap-2.5 border-b border-[#e3e9e5] bg-[#fbfcfb] sm:flex-row sm:items-center dark:border-dark-border dark:bg-dark-secondary/40",
            density === "compact" ? "px-3 py-2.5" : "p-3",
          )}
        >
          {toolbarLeading}
          {search && (
            <label className="relative min-w-0 flex-1 sm:max-w-md">
              <span className="sr-only">
                {search.label ?? `Search ${tableLabel}`}
              </span>
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#718078]" />
              <Input
                id={searchId}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder={search.placeholder ?? `Search ${tableLabel}…`}
                className="h-9 border-[#d7e0da] bg-white pl-9 pr-9 shadow-none dark:border-dark-border dark:bg-dark-tertiary"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => setSearchDraft("")}
                  className="absolute right-2 top-1.5 grid h-6 w-6 place-items-center rounded-md text-[#718078] hover:bg-[#edf1ed] hover:text-[#10211b] dark:hover:bg-dark-border dark:hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
          )}
          {toolbarActions && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {toolbarActions}
            </div>
          )}
        </div>
      )}

      {toolbarPanel && (
        <div className="shrink-0 border-b border-[#e3e9e5] bg-white p-3 dark:border-dark-border dark:bg-dark-elevated">
          {toolbarPanel}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table
          className={cn(
            "w-full min-w-[48rem] border-separate border-spacing-0 text-left",
            tableClassName,
          )}
        >
          <caption className="sr-only">{tableLabel}</caption>
          <thead className="sticky top-0 z-20">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    style={{ width: header.getSize() }}
                    className={cn(
                      "border-b border-[#d7e0da] bg-[#edf1ed]/95 px-4 text-[10px] font-bold uppercase tracking-[0.13em] text-[#5f6e66] backdrop-blur dark:border-dark-border dark:bg-dark-tertiary/95 dark:text-dark-text-secondary",
                      density === "compact" ? "py-2.5" : "py-3",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({
                length: Math.min(pagination.pageSize, 8),
              }).map((_, rowIndex) => (
                <tr key={`loading-row-${rowIndex}`}>
                  {columns.map((_, columnIndex) => (
                    <td
                      key={`loading-cell-${rowIndex}-${columnIndex}`}
                      className={cn(
                        "border-b border-[#edf1ed] px-4 dark:border-dark-border",
                        density === "compact" ? "py-2.5" : "py-3.5",
                      )}
                    >
                      <Skeleton
                        className={cn(
                          "h-4 rounded",
                          columnIndex === 0 ? "w-3/4" : "w-1/2",
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={columns.length} className="h-56 px-6 text-center">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    Could not load {tableLabel.toLowerCase()}
                  </p>
                  <p className="mt-1 text-xs text-[#718078] dark:text-dark-text-secondary">
                    {error.message}
                  </p>
                </td>
              </tr>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const subRow = renderSubRow?.(row.original);
                return (
                  <Fragment key={row.id}>
                    <tr className="group transition-colors hover:bg-[#f5f8f6] dark:hover:bg-dark-tertiary/45">
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn(
                            "border-b border-[#edf1ed] px-4 align-middle text-sm last:text-right dark:border-dark-border",
                            density === "compact" ? "py-2.5" : "py-3.5",
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                    {subRow && (
                      <tr>
                        <td
                          colSpan={row.getVisibleCells().length}
                          className="border-b border-[#d7e0da] bg-[#f8faf8] px-4 py-4 text-left dark:border-dark-border dark:bg-dark-tertiary/35"
                        >
                          {subRow}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-64 px-6 text-center">
                  <p className="text-sm font-semibold text-[#263b33] dark:text-dark-text-primary">
                    {emptyTitle}
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#718078] dark:text-dark-text-secondary">
                    {emptyDescription}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-[#d7e0da] bg-[#fbfcfb] px-3 py-2.5 text-xs text-[#65736d] sm:flex-row sm:items-center sm:justify-between dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
        <div className="flex items-center gap-2">
          <span>
            {visibleRange.start}–{visibleRange.end} of{" "}
            <strong className="font-semibold text-[#263b33] dark:text-dark-text-primary">
              {rowCount}
            </strong>
          </span>
          <span className="text-[#c1cbc5] dark:text-dark-border">•</span>
          <label className="flex items-center gap-1.5">
            Rows
            <select
              value={pagination.pageSize}
              onChange={(event) =>
                onPaginationChange({
                  pageIndex: 0,
                  pageSize: Number(event.target.value),
                })
              }
              className="h-7 rounded-md border border-[#d7e0da] bg-white px-1.5 text-xs text-[#263b33] dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="min-w-20 text-center">
            Page {pagination.pageIndex + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="First page"
              disabled={pagination.pageIndex === 0 || isFetching}
              onClick={() =>
                onPaginationChange({ ...pagination, pageIndex: 0 })
              }
              className="h-7 w-7"
            >
              <ChevronsLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous page"
              disabled={pagination.pageIndex === 0 || isFetching}
              onClick={() =>
                onPaginationChange({
                  ...pagination,
                  pageIndex: Math.max(0, pagination.pageIndex - 1),
                })
              }
              className="h-7 w-7"
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next page"
              disabled={pagination.pageIndex >= pageCount - 1 || isFetching}
              onClick={() =>
                onPaginationChange({
                  ...pagination,
                  pageIndex: Math.min(pageCount - 1, pagination.pageIndex + 1),
                })
              }
              className="h-7 w-7"
            >
              <ChevronRight />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Last page"
              disabled={pagination.pageIndex >= pageCount - 1 || isFetching}
              onClick={() =>
                onPaginationChange({
                  ...pagination,
                  pageIndex: pageCount - 1,
                })
              }
              className="h-7 w-7"
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </footer>
    </section>
  );
}
