import { cn } from "@/lib/utils";
import { formatDate } from "@/hooks/analytics";

export interface EngagementTrendData {
  date: string;
  engagementScore: number;
  activeContacts: number;
  messagesSent: number;
  messagesReceived: number;
  responseRate: number;
}

export interface EngagementTrendChartProps {
  data: EngagementTrendData[];
}

/**
 * Engagement trend chart
 */
export function EngagementTrendChart({ data }: EngagementTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
        No trend data available
      </p>
    );
  }

  // Show last 14 days
  const displayData = data.slice(-14);
  const maxScore = Math.max(...displayData.map((d) => d.engagementScore), 1);

  return (
    <div className="h-40">
      <div className="flex items-end gap-1 h-32">
        {displayData.map((day, i) => {
          const height =
            maxScore > 0 ? (day.engagementScore / maxScore) * 100 : 0;
          const scoreColor =
            day.engagementScore >= 70
              ? "bg-green-400 dark:bg-green-500 hover:bg-green-500 dark:hover:bg-green-600"
              : day.engagementScore >= 40
                ? "bg-yellow-400 dark:bg-yellow-500 hover:bg-yellow-500 dark:hover:bg-yellow-600"
                : day.engagementScore > 0
                  ? "bg-red-400 dark:bg-red-500 hover:bg-red-500 dark:hover:bg-red-600"
                  : "bg-gray-100 dark:bg-dark-tertiary";

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center"
              title={`${formatDate(day.date)}: Score ${day.engagementScore}, ${day.activeContacts} active, ${day.responseRate}% response rate`}
            >
              <div
                className="w-full flex items-end"
                style={{ height: "100px" }}
              >
                <div
                  className={cn("w-full rounded-t transition-all", scoreColor)}
                  style={{
                    height: `${Math.max(height, day.engagementScore > 0 ? 5 : 0)}%`,
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
      <div className="flex justify-center gap-4 mt-2 text-xs text-gray-500 dark:text-dark-text-secondary">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-400 dark:bg-green-500"></span>{" "}
          High (70+)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-yellow-400 dark:bg-yellow-500"></span>{" "}
          Medium (40-69)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-400 dark:bg-red-500"></span>{" "}
          Low (&lt;40)
        </span>
      </div>
    </div>
  );
}

export default EngagementTrendChart;
