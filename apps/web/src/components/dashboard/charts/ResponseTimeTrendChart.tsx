import { dayjs } from "@wateaminbox/shared";
import {
  chartBaseline,
  chartBox,
  formatAxisNumber,
  getAreaPath,
  getGridTicks,
  getLabelIndexes,
  getLinePoints,
  getNiceMax,
  getSmoothPath,
  plotHeight,
} from "./chart-utils";

export interface ResponseTimeTrendData {
  date: string;
  averageResponseTimeMinutes: number;
  conversationCount: number;
  slaComplianceRate: number;
}

interface ResponseTimeTrendChartProps {
  data: ResponseTimeTrendData[];
  slaThreshold: number;
}

export function ResponseTimeTrendChart({
  data,
  slaThreshold,
}: ResponseTimeTrendChartProps) {
  const displayData = data.slice(-14);
  const maxValue = getNiceMax([
    ...displayData.map((day) => day.averageResponseTimeMinutes),
    slaThreshold,
  ]);
  const points = getLinePoints(
    displayData.map((day) => day.averageResponseTimeMinutes),
    maxValue,
  );
  const thresholdY =
    chartBox.top +
    plotHeight -
    (slaThreshold / Math.max(maxValue, 1)) * plotHeight;
  const labelIndexes = getLabelIndexes(displayData.length);

  return (
    <svg
      viewBox={`0 0 ${chartBox.width} ${chartBox.height}`}
      className="h-[220px] w-full overflow-visible"
      role="img"
      aria-label={`Average response-time trend with a ${slaThreshold}-minute SLA target`}
    >
      <defs>
        <linearGradient id="response-time-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4185c5" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#4185c5" stopOpacity="0" />
        </linearGradient>
      </defs>

      {getGridTicks(maxValue).map((tick, index) => {
        const y = chartBox.top + (index / 4) * plotHeight;
        return (
          <g key={tick}>
            <line
              x1={chartBox.left}
              x2={chartBox.width - chartBox.right}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-[#e4eae6] dark:text-dark-border"
              strokeDasharray="3 5"
            />
            <text
              x={chartBox.left - 10}
              y={y + 4}
              textAnchor="end"
              className="fill-[#8a9690] text-[10px] dark:fill-dark-text-tertiary"
            >
              {formatAxisNumber(tick)}m
            </text>
          </g>
        );
      })}

      <line
        x1={chartBox.left}
        x2={chartBox.width - chartBox.right}
        y1={thresholdY}
        y2={thresholdY}
        stroke="#d18b35"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <text
        x={chartBox.width - chartBox.right}
        y={thresholdY - 7}
        textAnchor="end"
        className="fill-[#b36c24] text-[10px] font-semibold dark:fill-amber-300"
      >
        {slaThreshold}m SLA
      </text>

      <path d={getAreaPath(points)} fill="url(#response-time-area)" />
      <path
        d={getSmoothPath(points)}
        fill="none"
        stroke="#4185c5"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {displayData.map((day, index) => (
        <g key={day.date}>
          <circle
            cx={points[index].x}
            cy={points[index].y}
            r="4"
            fill={
              day.slaComplianceRate >= 90
                ? "#0b7a55"
                : day.slaComplianceRate >= 70
                  ? "#d18b35"
                  : "#cf5a5a"
            }
            stroke="white"
            strokeWidth="2"
          >
            <title>{`${dayjs(day.date).format("MMM D")}: ${formatMinutes(day.averageResponseTimeMinutes)} average, ${Math.round(day.slaComplianceRate)}% SLA`}</title>
          </circle>
          {labelIndexes.has(index) && (
            <text
              x={points[index].x}
              y={chartBaseline + 21}
              textAnchor={
                index === 0
                  ? "start"
                  : index === displayData.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-[#8a9690] text-[10px] dark:fill-dark-text-tertiary"
            >
              {dayjs(day.date).format("MMM D")}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default ResponseTimeTrendChart;
