import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the profile panel
 */
export function ContactProfileSkeleton() {
  return (
    <div>
      <div className="flex flex-col items-center gap-2 bg-gray-50 py-5 dark:bg-dark-elevated">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      {Array.from({ length: 5 }).map((_, index) => (
        <section
          key={index}
          className="border-b border-gray-200 bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary"
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
