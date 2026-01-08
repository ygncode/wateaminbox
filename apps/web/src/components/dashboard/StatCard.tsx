import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui";
import { formatNumber } from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  icon: ReactNode;
  label: string;
  value?: number;
  isLoading: boolean;
  accent?: "green" | "blue" | "orange";
}

const accentColors = {
  green: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30",
  blue: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
  orange:
    "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30",
};

/**
 * Stat card component for overview statistics
 */
export function StatCard({
  icon,
  label,
  value,
  isLoading,
  accent,
}: StatCardProps) {
  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-4">
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center mb-3",
          accent
            ? accentColors[accent]
            : "text-gray-500 dark:text-dark-text-secondary bg-gray-100 dark:bg-dark-tertiary",
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

export default StatCard;
