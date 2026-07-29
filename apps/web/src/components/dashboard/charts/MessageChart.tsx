import { formatDate, formatNumber } from "@/hooks/analytics";
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

export interface MessageChartProps {
  data: { date: string; sent: number; received: number }[];
}

export function MessageChart({ data }: MessageChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No message activity in this period" />;
  }

  const displayData = data.slice(-14);
  const maxValue = getNiceMax(
    displayData.flatMap((day) => [day.sent, day.received]),
  );
  const sentPoints = getLinePoints(
    displayData.map((day) => day.sent),
    maxValue,
  );
  const receivedPoints = getLinePoints(
    displayData.map((day) => day.received),
    maxValue,
  );
  const labelIndexes = getLabelIndexes(displayData.length);
  const totalSent = displayData.reduce((total, day) => total + day.sent, 0);
  const totalReceived = displayData.reduce(
    (total, day) => total + day.received,
    0,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-5">
          <Metric label="Sent" value={totalSent} color="emerald" />
          <Metric label="Received" value={totalReceived} color="blue" />
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium text-[#718078] dark:text-dark-text-secondary">
          <LegendDot color="bg-[#0b7a55]" label="Outbound" />
          <LegendDot color="bg-[#4185c5]" label="Inbound" />
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartBox.width} ${chartBox.height}`}
        className="h-[220px] w-full overflow-visible"
        role="img"
        aria-label={`Message trend showing ${formatNumber(totalSent)} sent and ${formatNumber(totalReceived)} received messages`}
      >
        <defs>
          <linearGradient id="message-sent-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0b7a55" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#0b7a55" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="message-received-area"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#4185c5" stopOpacity="0.18" />
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
                {formatAxisNumber(tick)}
              </text>
            </g>
          );
        })}

        <path d={getAreaPath(sentPoints)} fill="url(#message-sent-area)" />
        <path
          d={getAreaPath(receivedPoints)}
          fill="url(#message-received-area)"
        />
        <path
          d={getSmoothPath(sentPoints)}
          fill="none"
          stroke="#0b7a55"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d={getSmoothPath(receivedPoints)}
          fill="none"
          stroke="#4185c5"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {displayData.map((day, index) => (
          <g key={day.date}>
            <circle
              cx={sentPoints[index].x}
              cy={sentPoints[index].y}
              r="7"
              fill="transparent"
            >
              <title>{`${formatDate(day.date)}: ${day.sent} sent`}</title>
            </circle>
            <circle
              cx={receivedPoints[index].x}
              cy={receivedPoints[index].y}
              r="7"
              fill="transparent"
            >
              <title>{`${formatDate(day.date)}: ${day.received} received`}</title>
            </circle>
            {labelIndexes.has(index) && (
              <text
                x={sentPoints[index].x}
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
                {formatDate(day.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "emerald" | "blue";
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
        {label}
      </p>
      <p
        className={
          color === "emerald"
            ? "text-xl font-semibold tabular-nums text-[#075c41] dark:text-emerald-300"
            : "text-xl font-semibold tabular-nums text-[#326fa8] dark:text-blue-300"
        }
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="grid h-[276px] place-items-center rounded-xl border border-dashed border-[#dce3de] bg-[#fafcfb] text-sm text-[#718078] dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
      {message}
    </div>
  );
}

export default MessageChart;
