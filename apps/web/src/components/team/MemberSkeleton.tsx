import { Skeleton } from "@/components/ui/skeleton";

/**
 * Member loading skeleton
 */
export function MemberSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-1 h-4 w-20" />
        </div>
      </div>
    </div>
  );
}
