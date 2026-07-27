import { CheckCircle, CircleDot, Clock, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useResolutionStats } from "@/hooks/analytics";
import { useAsyncData } from "@/hooks/useAsyncData";
import { StatCard } from "./StatCard";

interface ResolutionRateSectionProps {
  companyId: string;
}

/**
 * Self-contained Resolution Rate analytics section.
 * Fetches its own data and handles loading/error/empty states internally.
 */
export function ResolutionRateSection({
  companyId,
}: ResolutionRateSectionProps) {
  const resolutionQuery = useResolutionStats(companyId);
  const { renderState } = useAsyncData(resolutionQuery);

  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
        <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
          Resolution Rate
        </h3>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          All time
        </span>
      </div>

      {renderState({
        loading: () => (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ),
        error: () => (
          <p className="text-red-500 dark:text-red-400 text-center py-4">
            Failed to load resolution data
          </p>
        ),
        empty: () => (
          <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
            No resolution data available
          </p>
        ),
        success: (data) => {
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                variant="compact"
                icon={<CircleDot className="h-5 w-5" />}
                label="Open"
                value={data.openConversations}
                color="blue"
              />
              <StatCard
                variant="compact"
                icon={<Clock className="h-5 w-5" />}
                label="Pending"
                value={data.pendingConversations}
                color="yellow"
              />
              <StatCard
                variant="compact"
                icon={<CheckCircle className="h-5 w-5" />}
                label="Resolved"
                value={data.resolvedConversations}
                color="green"
              />
              <StatCard
                variant="compact"
                icon={<Target className="h-5 w-5" />}
                label="Resolution Rate"
                value={data.resolutionRate}
                suffix="%"
                color="purple"
              />
            </div>
          );
        },
      })}
    </div>
  );
}
