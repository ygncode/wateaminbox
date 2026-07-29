import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/hooks/analytics";
import { cn } from "@/lib/utils";

/**
 * All supported accent colors for stat cards
 */
export type StatCardColor =
  | "green"
  | "blue"
  | "orange"
  | "yellow"
  | "purple"
  | "default";

const colorClasses: Record<StatCardColor, string> = {
  green:
    "text-[#0b7a55] dark:text-emerald-300 bg-[#e5f2ec] dark:bg-emerald-950/50",
  blue: "text-[#3f78ad] dark:text-blue-300 bg-[#eaf1f7] dark:bg-blue-950/40",
  orange:
    "text-[#b36c24] dark:text-amber-300 bg-[#fff2df] dark:bg-amber-950/40",
  yellow:
    "text-[#a47718] dark:text-yellow-300 bg-[#fff8dd] dark:bg-yellow-950/40",
  purple:
    "text-[#70649a] dark:text-violet-300 bg-[#f1eef8] dark:bg-violet-950/40",
  default:
    "text-[#536b62] dark:text-dark-text-secondary bg-[#edf2ef] dark:bg-dark-tertiary",
};

const accentClasses: Record<StatCardColor, string> = {
  green: "bg-[#0b7a55]",
  blue: "bg-[#4185c5]",
  orange: "bg-[#d18b35]",
  yellow: "bg-[#c79a2e]",
  purple: "bg-[#7b6ca8]",
  default: "bg-[#8da097]",
};

/**
 * Props for the overview variant (icon above label, with border)
 */
export interface StatCardOverviewProps {
  variant?: "overview";
  icon: ReactNode;
  label: string;
  value?: number;
  isLoading: boolean;
  color?: StatCardColor;
}

/**
 * Props for the compact variant (icon inline with label, no border)
 */
export interface StatCardCompactProps {
  variant: "compact";
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  detail?: string;
  color: Exclude<StatCardColor, "default">;
}

export type StatCardProps = StatCardOverviewProps | StatCardCompactProps;

/**
 * Unified stat card component supporting two variants:
 *
 * - `overview` (default): Icon above label, white background with border, loading state
 *   Used in DashboardStats for overview metrics
 *
 * - `compact`: Icon inline with label, gray background, optional suffix and detail
 *   Used in EngagementSection and ResolutionSection for metric grids
 */
export function StatCard(props: StatCardProps) {
  if (props.variant === "compact") {
    return <CompactStatCard {...props} />;
  }

  return <OverviewStatCard {...props} />;
}

/**
 * Overview variant - icon above label, with border and loading state
 */
function OverviewStatCard({
  icon,
  label,
  value,
  isLoading,
  color = "default",
}: StatCardOverviewProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-[#dce3de] bg-white p-4 shadow-[0_1px_1px_rgba(16,44,36,0.03)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#bdcbc3] hover:shadow-[0_8px_24px_rgba(16,44,36,0.08)] dark:border-dark-border dark:bg-dark-elevated dark:hover:border-[#43525b]">
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 opacity-80",
          accentClasses[color],
        )}
      />
      <div
        className={cn(
          "mb-4 flex h-9 w-9 items-center justify-center rounded-xl",
          colorClasses[color],
        )}
      >
        {icon}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
        {label}
      </p>
      {isLoading ? (
        <Skeleton className="mt-1.5 h-8 w-16" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-[#203b32] tabular-nums dark:text-dark-text-primary">
          {value !== undefined ? formatNumber(value) : "-"}
        </p>
      )}
    </div>
  );
}

/**
 * Compact variant - icon inline with label, no border
 */
function CompactStatCard({
  icon,
  label,
  value,
  suffix,
  detail,
  color,
}: StatCardCompactProps) {
  return (
    <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/60">
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            colorClasses[color],
          )}
        >
          {icon}
        </div>
        <span className="text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
          {label}
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-[-0.02em] text-[#203b32] tabular-nums dark:text-dark-text-primary">
        {formatNumber(value)}
        {suffix}
      </p>
      {detail && (
        <p className="mt-1 text-[11px] text-[#87928c] dark:text-dark-text-secondary">
          {detail}
        </p>
      )}
    </div>
  );
}

export default StatCard;
