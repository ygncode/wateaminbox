import { formatDate, formatNumber } from "@/hooks/analytics";
import {
  chartBaseline,
  chartBox,
  getAreaPath,
  getLabelIndexes,
  getLinePoints,
  getSmoothPath,
  plotHeight,
  plotWidth,
} from "./chart-utils";

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

export function EngagementTrendChart({ data }: EngagementTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="grid h-[240px] place-items-center rounded-xl border border-dashed border-[#dce3de] bg-[#fafcfb] text-sm text-[#718078] dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
        No engagement trend in this period
      </div>
    );
  }

  const displayData = data.slice(-14);
  const scorePoints = getLinePoints(
    displayData.map((day) => day.engagementScore),
    100,
  );
  const responsePoints = getLinePoints(
    displayData.map((day) => day.responseRate),
    100,
  );
  const labelIndexes = getLabelIndexes(displayData.length);
  const averageScore = Math.round(
    displayData.reduce((total, day) => total + day.engagementScore, 0) /
      displayData.length,
  );
  const activeContacts = displayData.reduce(
    (total, day) => total + day.activeContacts,
    0,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
              Average score
            </p>
            <p className="text-xl font-semibold tabular-nums text-[#075c41] dark:text-emerald-300">
              {averageScore}
              <span className="ml-0.5 text-xs font-medium text-[#7c8983]">
                /100
              </span>
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
              Active touches
            </p>
            <p className="text-sm font-semibold tabular-nums text-[#31463e] dark:text-dark-text-primary">
              {formatNumber(activeContacts)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium text-[#718078] dark:text-dark-text-secondary">
          <Legend swatch="bg-[#0b7a55]" label="Engagement" />
          <Legend
            swatch="border-t-2 border-dashed border-[#d18b35]"
            label="Response"
          />
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartBox.width} ${chartBox.height}`}
        className="h-[220px] w-full overflow-visible"
        role="img"
        aria-label={`Engagement trend with an average score of ${averageScore} out of 100`}
      >
        <defs>
          <linearGradient id="engagement-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0b7a55" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0b7a55" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect
          x={chartBox.left}
          y={chartBox.top}
          width={plotWidth}
          height={plotHeight * 0.3}
          fill="#e8f4ee"
          className="dark:fill-emerald-950/20"
          rx="8"
        />
        {[100, 75, 50, 25, 0].map((tick, index) => {
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
                {tick}
              </text>
            </g>
          );
        })}

        <path d={getAreaPath(scorePoints)} fill="url(#engagement-area)" />
        <path
          d={getSmoothPath(scorePoints)}
          fill="none"
          stroke="#0b7a55"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d={getSmoothPath(responsePoints)}
          fill="none"
          stroke="#d18b35"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="6 5"
        />

        {displayData.map((day, index) => (
          <g key={day.date}>
            <circle
              cx={scorePoints[index].x}
              cy={scorePoints[index].y}
              r="7"
              fill="transparent"
            >
              <title>{`${formatDate(day.date)}: ${day.engagementScore}/100 engagement, ${day.responseRate}% response rate`}</title>
            </circle>
            {labelIndexes.has(index) && (
              <text
                x={scorePoints[index].x}
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

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-4 rounded-full ${swatch}`} />
      {label}
    </span>
  );
}

export default EngagementTrendChart;
