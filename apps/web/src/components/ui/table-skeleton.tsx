import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/*
 * Placeholders for ServerDataTable pages and page headers.
 *
 * Every box copies the classes of the real element (ServerDataTable's
 * section/toolbar/thead/footer, the shared page header), and text is a
 * `SkeletonLine`: a bar centred in a box exactly one real line tall. Sizes
 * that depend on content (row heights) are passed in from the measured page,
 * see DESIGN.md → Loading skeletons.
 */

/** One line of text: a box as tall as the real line, holding a bar. */
export function SkeletonLine({
  className,
  bar,
}: {
  /** Height (and margin) of the real line, e.g. `h-5` for text-sm. */
  className: string;
  /** Bar width/height, e.g. `h-3 w-24`. */
  bar: string;
}) {
  return (
    <div className={cn("flex items-center", className)}>
      <Skeleton className={bar} />
    </div>
  );
}

/** Icon tile + title + subtitle, as in the Audit/Broadcasts/Notifications/Dashboard headers. */
export function PageHeaderSkeleton({
  action,
  tall = false,
  titleWidth = "w-28",
}: {
  /** Width class of a trailing action button, if the real header has one. */
  action?: string;
  /** The real header row reserves `min-h-10` (Broadcasts). */
  tall?: boolean;
  titleWidth?: string;
}) {
  return (
    <header
      data-sk="page-header"
      className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6"
    >
      <div className={cn("flex items-center gap-3", tall && "min-h-10")}>
        <Skeleton className="size-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <SkeletonLine className="h-[18px]" bar={cn("h-3.5", titleWidth)} />
          <SkeletonLine className="mt-1 h-4" bar="h-2.5 w-64 max-w-[60vw]" />
        </div>
        {action && (
          <Skeleton className={cn("h-8 shrink-0 rounded-lg", action)} />
        )}
      </div>
    </header>
  );
}

export interface TableCardSkeletonProps {
  /** ServerDataTable `density`. */
  density?: "default" | "compact";
  /**
   * What the real toolbar holds: a search field + filter (Team), a title
   * block (Broadcasts), or a title block + action group (Audit).
   */
  toolbar: "search" | "leading" | "leading-actions";
  /** Measured height of one loaded row, in px. */
  rowHeight: number;
  columns: number;
  rows?: number;
  /** ServerDataTable `tableClassName` (minimum width). */
  tableClassName?: string;
  className?: string;
}

/** ServerDataTable while its page chunk or first page loads. */
export function TableCardSkeleton({
  density = "default",
  toolbar,
  rowHeight,
  columns,
  rows = 10,
  tableClassName,
  className,
}: TableCardSkeletonProps) {
  const compact = density === "compact";
  return (
    <section
      data-sk="card"
      aria-hidden="true"
      className={cn(
        "relative flex h-full min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg",
        className,
      )}
    >
      <div
        data-sk="toolbar"
        className={cn(
          "flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface/40 sm:flex-row sm:items-center",
          compact ? "px-3 py-2.5" : "p-3",
        )}
      >
        {toolbar === "search" ? (
          <>
            <Skeleton className="h-9 w-full min-w-0 rounded-lg sm:max-w-md sm:flex-1" />
            <div className="ms-auto flex h-9 shrink-0 items-center">
              <Skeleton className="h-9 w-[6.5rem] rounded-lg sm:w-[8.5rem]" />
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2.5">
              <Skeleton className="size-7 shrink-0 rounded-lg" />
              <div className="min-w-0">
                <SkeletonLine className="h-4" bar="h-2.5 w-28" />
                <SkeletonLine
                  className="hidden h-[15px] sm:flex"
                  bar="h-2 w-48"
                />
              </div>
            </div>
            {toolbar === "leading-actions" && (
              <div className="ms-auto flex shrink-0 items-center">
                <Skeleton className="h-[38px] w-44 rounded-lg sm:w-[11.75rem]" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <table
          className={cn(
            "w-full min-w-[48rem] border-separate border-spacing-0",
            tableClassName,
          )}
        >
          <thead data-sk="thead">
            <tr>
              {Array.from({ length: columns }, (_, index) => (
                <th
                  key={index}
                  className={cn(
                    "border-b border-line bg-muted/95 px-4",
                    compact ? "py-2.5" : "py-3",
                  )}
                >
                  <SkeletonLine
                    className="h-4"
                    bar={cn("h-2", index === 0 ? "w-16" : "w-10")}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr data-sk="trow" key={row} style={{ height: rowHeight }}>
                {Array.from({ length: columns }, (_, index) => (
                  <td key={index} className="border-b border-line px-4">
                    {index === 0 ? (
                      <>
                        <Skeleton
                          className={cn("h-3.5", row % 2 ? "w-36" : "w-44")}
                        />
                        <Skeleton className="mt-2 h-2.5 w-28" />
                      </>
                    ) : (
                      <Skeleton
                        className={cn("h-3", index % 2 ? "w-20" : "w-16")}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TableFooterSkeleton />
    </section>
  );
}

/** ServerDataTable pagination footer. */
export function TableFooterSkeleton() {
  return (
    <footer
      data-sk="tfoot"
      className="flex shrink-0 flex-col gap-3 border-t border-line bg-surface/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex h-7 items-center gap-2">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>
      <div className="flex h-7 items-center justify-between gap-2 sm:justify-end">
        <Skeleton className="h-2.5 w-16" />
        <div className="flex gap-1">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="size-7 rounded-md" />
          ))}
        </div>
      </div>
    </footer>
  );
}
