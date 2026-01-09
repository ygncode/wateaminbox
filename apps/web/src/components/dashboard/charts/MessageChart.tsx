import { formatDate } from "@/hooks/analytics";

export interface MessageChartProps {
  data: { date: string; sent: number; received: number }[];
}

/**
 * Simple message trend chart (bar chart)
 */
export function MessageChart({ data }: MessageChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-gray-500 dark:text-dark-text-secondary text-center py-8">
        No data available
      </p>
    );
  }

  const maxValue = Math.max(...data.flatMap((d) => [d.sent, d.received]));

  return (
    <div className="h-48 flex items-end gap-1">
      {data.slice(-14).map((day, i) => {
        const sentHeight = maxValue > 0 ? (day.sent / maxValue) * 100 : 0;
        const receivedHeight =
          maxValue > 0 ? (day.received / maxValue) * 100 : 0;

        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-1"
            title={formatDate(day.date)}
          >
            <div
              className="w-full flex gap-0.5 items-end"
              style={{ height: "160px" }}
            >
              <div
                className="flex-1 bg-green-400 dark:bg-green-500 rounded-t transition-all"
                style={{ height: `${sentHeight}%` }}
              />
              <div
                className="flex-1 bg-blue-400 dark:bg-blue-500 rounded-t transition-all"
                style={{ height: `${receivedHeight}%` }}
              />
            </div>
            {i === 0 || i === data.slice(-14).length - 1 ? (
              <span className="text-[10px] text-gray-400 dark:text-dark-text-tertiary">
                {formatDate(day.date)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default MessageChart;
