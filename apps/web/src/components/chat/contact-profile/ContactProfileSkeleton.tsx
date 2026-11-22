import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the profile panel
 */
export function ContactProfileSkeleton() {
  return (
    <div>
      <div
        data-sk="profile-head"
        className="flex flex-col items-center gap-2 bg-surface py-5"
      >
        <Skeleton className="size-20 rounded-full" />
        {/* Name line only: the secondary identity line (username, merged
            count) is usually empty and collapses to nothing. */}
        <div className="flex h-6 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      {Array.from({ length: 5 }).map((_, index) => (
        <section
          key={index}
          className="border-b border-line bg-surface px-4 py-3"
        >
          <Skeleton className="h-3.5 w-24" />
          <div className="mt-3 space-y-2.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton
              className={index % 2 === 0 ? "h-3 w-3/4" : "h-8 w-full"}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
