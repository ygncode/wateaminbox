import { CheckCircle, CircleDot, Clock, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useResolutionStats } from "@/hooks/analytics";
import { StatCard } from "./StatCard";

interface ResolutionRateSectionProps {
  companyId: string;
  startDate: string;
  endDate: string;
}

/**
 * Self-contained Resolution Rate analytics section.
 * Fetches its own data and handles loading/error/empty states internally.
 */
export function ResolutionRateSection({
  companyId,
  startDate,
  endDate,
}: ResolutionRateSectionProps) {
  const resolutionQuery = useResolutionStats(companyId, startDate, endDate);
  const { renderState } = useAsyncData(resolutionQuery);

  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
        <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
          Resolution Rate
        </h3>
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
        success: (response) => {
          const data = response.data;
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
