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
    <section className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5f2ec] text-[#0b7a55] dark:bg-emerald-950/50 dark:text-emerald-300">
          <Target className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
            Conversation outcomes
          </h3>
          <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
            Open, pending, and completed work
          </p>
        </div>
        <span className="ml-auto rounded-full border border-[#dce3de] bg-[#fafcfb] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#718078] dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text-secondary">
          All time
        </span>
      </div>

      {renderState({
        loading: () => (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                variant="compact"
                icon={<CircleDot className="h-4 w-4" />}
                label="Open"
                value={data.openConversations}
                color="blue"
              />
              <StatCard
                variant="compact"
                icon={<Clock className="h-4 w-4" />}
                label="Pending"
                value={data.pendingConversations}
                color="yellow"
              />
              <StatCard
                variant="compact"
                icon={<CheckCircle className="h-4 w-4" />}
                label="Resolved"
                value={data.resolvedConversations}
                color="green"
              />
              <StatCard
                variant="compact"
                icon={<Target className="h-4 w-4" />}
                label="Resolution Rate"
                value={data.resolutionRate}
                suffix="%"
                color="purple"
              />
            </div>
          );
        },
      })}
    </section>
  );
}
