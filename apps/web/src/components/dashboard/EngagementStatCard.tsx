import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EngagementStatCardProps {
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  detail?: string;
  color: "blue" | "green" | "purple" | "orange";
}

const colorClasses = {
  blue: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
  green: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30",
  purple:
    "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30",
  orange:
    "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30",
};

/**
 * Engagement stat card component with detail line
 */
export function EngagementStatCard({
  icon,
  label,
  value,
  suffix,
  detail,
  color,
}: EngagementStatCardProps) {
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
        {value}
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

export default EngagementStatCard;
