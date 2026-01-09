import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/hooks/analytics";

export interface NewContactsChartProps {
  data: { date: string; count: number; cumulativeTotal: number }[];
}

/**
 * New contacts trend chart with bar and cumulative line
 */
export function NewContactsChart({ data }: NewContactsChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-gray-500 dark:text-dark-text-secondary text-center py-8">
        No data available
      </p>
    );
  }

  // Get last 14 days for display
  const displayData = data.slice(-14);
  const maxCount = Math.max(...displayData.map((d) => d.count));
  const totalNew = displayData.reduce((sum, d) => sum + d.count, 0);
  const latestCumulative =
    displayData[displayData.length - 1]?.cumulativeTotal || 0;

  return (
    <div className="h-48">
      {/* Summary stats */}
      <div className="flex justify-between text-xs text-gray-500 dark:text-dark-text-secondary mb-2">
        <span>
          <span className="font-medium text-purple-600 dark:text-purple-400">
            +{totalNew}
          </span>{" "}
          new
        </span>
        <span>
          Total:{" "}
          <span className="font-medium text-gray-700 dark:text-dark-text-primary">
            {formatNumber(latestCumulative)}
          </span>
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-36">
        {displayData.map((day, i) => {
          const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center"
              title={`${formatDate(day.date)}: ${day.count} new (Total: ${day.cumulativeTotal})`}
            >
              <div
                className="w-full flex items-end"
                style={{ height: "120px" }}
              >
                <div
                  className={cn(
                    "w-full rounded-t transition-all",
                    day.count > 0
                      ? "bg-purple-400 dark:bg-purple-500 hover:bg-purple-500 dark:hover:bg-purple-600"
                      : "bg-gray-100 dark:bg-dark-tertiary",
                  )}
                  style={{
                    height: `${Math.max(height, day.count > 0 ? 5 : 0)}%`,
                  }}
                />
              </div>
              {i === 0 || i === displayData.length - 1 ? (
                <span className="text-[10px] text-gray-400 dark:text-dark-text-tertiary mt-1">
                  {formatDate(day.date)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default NewContactsChart;
