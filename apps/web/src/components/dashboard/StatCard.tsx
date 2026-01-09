import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui";
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
  green: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30",
  blue: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
  orange:
    "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30",
  yellow:
    "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30",
  purple:
    "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30",
  default:
    "text-gray-500 dark:text-dark-text-secondary bg-gray-100 dark:bg-dark-tertiary",
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
    <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-4">
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center mb-3",
          colorClasses[color],
        )}
      >
        {icon}
      </div>
      <p className="text-xs text-gray-500 dark:text-dark-text-secondary uppercase tracking-wider">
        {label}
      </p>
      {isLoading ? (
        <Skeleton className="h-7 w-16 mt-1" />
      ) : (
        <p className="text-2xl font-semibold text-gray-900 dark:text-dark-text-primary">
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
    <div className="bg-gray-50 dark:bg-dark-tertiary rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            colorClasses[color],
          )}
        >
          {icon}
        </div>
        <span className="text-sm text-gray-600 dark:text-dark-text-secondary">
          {label}
        </span>
      </div>
      <p className="text-2xl font-semibold text-gray-900 dark:text-dark-text-primary">
        {formatNumber(value)}
        {suffix}
      </p>
      {detail && (
        <p className="text-xs text-gray-500 dark:text-dark-text-secondary mt-1">
          {detail}
        </p>
      )}
    </div>
  );
}

export default StatCard;
