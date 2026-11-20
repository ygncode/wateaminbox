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
  green: "text-accent bg-accent-soft",
  blue: "text-info bg-info-soft",
  orange: "text-warning bg-warning-soft",
  yellow: "text-warning bg-warning-soft",
  purple: "text-fg-muted bg-muted",
  default: "text-fg-muted bg-muted",
};

const accentClasses: Record<StatCardColor, string> = {
  green: "bg-primary",
  blue: "bg-info",
  orange: "bg-warning",
  yellow: "bg-warning",
  purple: "bg-fg-subtle",
  default: "bg-fg-subtle",
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
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg">
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
        {label}
      </p>
      {isLoading ? (
        <Skeleton className="mt-1.5 h-8 w-16" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg tabular-nums">
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
    <div className="rounded-xl border border-line bg-muted/60 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            colorClasses[color],
          )}
        >
          {icon}
        </div>
        <span className="text-xs font-medium text-fg-muted">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-[-0.02em] text-fg tabular-nums">
        {formatNumber(value)}
        {suffix}
      </p>
      {detail && <p className="mt-1 text-[11px] text-fg-muted">{detail}</p>}
    </div>
  );
}
