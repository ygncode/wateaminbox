import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Inbox list placeholders, shared by every place the list loads: the
 * cold-load app shell (PageSkeleton), the list's own loading state, and the
 * groups tab. Each band copies the padding, height and row classes of the
 * real component it stands in for (ChatList, ChatListItem), so the swap to
 * data changes content, never layout. `data-sk` marks the landmarks the
 * skeleton audit compares (see DESIGN.md → Loading skeletons).
 */

/** ChatList toolbar: search row, then the lifecycle control and Filter. */
export function ChatListToolbarSkeleton() {
  return (
    <>
      <div
        data-sk="list-search"
        className="flex items-center gap-2 bg-panel px-3 pt-3 pb-2"
      >
        <Skeleton className="h-[38px] min-w-0 flex-1 rounded-lg" />
        <Skeleton className="size-9 shrink-0 rounded-lg" />
      </div>
      <div
        data-sk="list-filters"
        className="flex items-center gap-2 border-b border-line bg-panel px-3 pb-2.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-chip p-0.5">
          <span className="h-7 flex-1 rounded-md bg-chip-on shadow-xs" />
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="flex h-7 flex-1 items-center justify-center"
            >
              <Skeleton className="h-2.5 w-10" />
            </span>
          ))}
        </div>
        <Skeleton className="h-8 w-[4.25rem] shrink-0 rounded-lg" />
      </div>
    </>
  );
}

/** One conversation row, same box as ChatListItem. */
export function ChatListRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div
      data-sk="list-row"
      aria-hidden="true"
      className="list-row flex min-h-[68px] w-full items-center gap-3 border-b border-row-line px-3 py-2.5"
    >
      <Skeleton
        data-sk="list-avatar"
        className="size-11 shrink-0 rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center justify-between gap-2">
          <Skeleton className={cn("h-3.5", index % 2 ? "w-28" : "w-36")} />
          <Skeleton className="h-2.5 w-9 shrink-0" />
        </div>
        <div className="mt-0.5 flex h-5 items-center">
          <Skeleton className={cn("h-3", index % 3 ? "w-52" : "w-40")} />
        </div>
      </div>
    </div>
  );
}

export function ChatListRowsSkeleton({ count = 9 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <ChatListRowSkeleton key={index} index={index} />
      ))}
    </>
  );
}
