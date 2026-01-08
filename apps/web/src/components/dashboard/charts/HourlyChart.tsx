export interface HourlyChartProps {
  data: { hour: number; count: number }[];
}

/**
 * Hourly activity chart
 */
export function HourlyChart({ data }: HourlyChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-gray-500 dark:text-dark-text-secondary text-center py-8">
        No data available
      </p>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.count));

  return (
    <div className="h-48 flex items-end gap-0.5">
      {data.map((hour) => {
        const height = maxValue > 0 ? (hour.count / maxValue) * 100 : 0;

        return (
          <div
            key={hour.hour}
            className="flex-1 flex flex-col items-center"
            title={`${hour.hour}:00 - ${hour.count} messages`}
          >
            <div className="w-full flex items-end" style={{ height: "140px" }}>
              <div
                className="w-full bg-whatsapp-teal-green rounded-t transition-all hover:bg-whatsapp-dark-green"
                style={{ height: `${height}%` }}
              />
            </div>
            {hour.hour % 6 === 0 && (
              <span className="text-[10px] text-gray-400 dark:text-dark-text-tertiary mt-1">
                {hour.hour}:00
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default HourlyChart;
