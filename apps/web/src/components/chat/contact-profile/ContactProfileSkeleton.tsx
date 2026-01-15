import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the profile panel
 */
export function ContactProfileSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center gap-4 py-8">
        <Skeleton className="h-32 w-32 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
