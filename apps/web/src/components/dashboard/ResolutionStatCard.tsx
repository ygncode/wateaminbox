import type { ReactNode } from "react";
import { formatNumber } from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";

export interface ResolutionStatCardProps {
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  color: "blue" | "yellow" | "green" | "purple";
}

const colorClasses = {
  blue: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
  yellow:
    "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30",
  green: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30",
  purple:
    "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30",
};

/**
 * Resolution stat card component
 */
export function ResolutionStatCard({
  icon,
  label,
  value,
  suffix,
  color,
}: ResolutionStatCardProps) {
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
    </div>
  );
}

export default ResolutionStatCard;
