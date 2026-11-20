import { formatDate, formatNumber } from "@/hooks/analytics";
import {
  chartBaseline,
  chartBox,
  getGridTicks,
  getLabelIndexes,
  getLinePoints,
  getNiceMax,
  getSmoothPath,
  plotHeight,
  plotWidth,
} from "./chart-utils";
import { useTranslation } from "react-i18next";

export interface NewContactsChartProps {
  data: { date: string; count: number; cumulativeTotal: number }[];
}

export function NewContactsChart({ data }: NewContactsChartProps) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return <ChartEmptyState />;
  }

  const displayData = data;
  const maxCount = getNiceMax(displayData.map((day) => day.count));
  const totalNew = displayData.reduce((sum, day) => sum + day.count, 0);
  const latestCumulative =
    displayData[displayData.length - 1]?.cumulativeTotal ?? 0;
  const cumulativeValues = displayData.map((day) => day.cumulativeTotal);
  const cumulativeMin = Math.min(...cumulativeValues);
  const cumulativeRange = Math.max(
    Math.max(...cumulativeValues) - cumulativeMin,
    1,
  );
  const cumulativePoints = getLinePoints(
    cumulativeValues.map((value) => value - cumulativeMin),
    cumulativeRange,
  );
  const labelIndexes = getLabelIndexes(displayData.length);
  const slotWidth = plotWidth / Math.max(displayData.length, 1);
  const barWidth = Math.min(slotWidth * 0.54, 24);

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
            {t("dashboard.charts.newInPeriod", "New in period")}
          </p>
          <p className="text-xl font-semibold tabular-nums text-accent">
            +{formatNumber(totalNew)}
          </p>
        </div>
        <div className="text-end">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
            {t("dashboard.charts.contactBase", "Contact base")}
          </p>
          <p className="text-sm font-semibold tabular-nums text-fg">
            {formatNumber(latestCumulative)}
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartBox.width} ${chartBox.height}`}
        className="h-[220px] w-full overflow-visible"
        role="img"
        aria-label={`${formatNumber(totalNew)} new contacts, ${formatNumber(latestCumulative)} total contacts`}
      >
        <defs>
          <linearGradient id="contact-bar-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" />
            <stop offset="100%" stopColor="var(--chart-1)" />
          </linearGradient>
        </defs>

        {getGridTicks(maxCount).map((tick, index) => {
          const y = chartBox.top + (index / 4) * plotHeight;
          return (
            <line
              key={tick}
              x1={chartBox.left}
              x2={chartBox.width - chartBox.right}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-fg-subtle"
              strokeDasharray="3 5"
            />
          );
        })}

        {displayData.map((day, index) => {
          const height = (day.count / maxCount) * plotHeight;
          const x =
            chartBox.left + index * slotWidth + (slotWidth - barWidth) / 2;

          return (
            <g key={day.date}>
              <rect
                x={x}
                y={chartBaseline - Math.max(height, day.count > 0 ? 3 : 0)}
                width={barWidth}
                height={Math.max(height, day.count > 0 ? 3 : 0)}
                rx={barWidth / 2}
                fill={
                  day.count > 0 ? "url(#contact-bar-fill)" : "var(--chart-grid)"
                }
                className="transition-opacity hover:opacity-75"
              >
                <title>{`${formatDate(day.date)}: ${day.count} new contacts, ${day.cumulativeTotal} total`}</title>
              </rect>
              {labelIndexes.has(index) && (
                <text
                  x={x + barWidth / 2}
                  y={chartBaseline + 21}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === displayData.length - 1
                        ? "end"
                        : "middle"
                  }
                  className="fill-fg-muted text-[10px]"
                >
                  {formatDate(day.date)}
                </text>
              )}
            </g>
          );
        })}

        <path
          d={getSmoothPath(cumulativePoints)}
          fill="none"
          stroke="var(--chart-3)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="5 4"
        />
        <circle
          cx={cumulativePoints[cumulativePoints.length - 1].x}
          cy={cumulativePoints[cumulativePoints.length - 1].y}
          r="4"
          fill="var(--surface)"
          stroke="var(--chart-3)"
          strokeWidth="3"
        />
      </svg>

      <div className="-mt-1 flex justify-end">
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-fg-muted">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-warning" />
          {t("dashboard.charts.cumulativeGrowth", "Cumulative growth")}
        </span>
      </div>
    </div>
  );
}

function ChartEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="grid h-[276px] place-items-center rounded-xl border border-dashed border-line bg-subtle text-sm text-fg-muted">
      {t("dashboard.charts.noNewContacts", "No new contacts in this period")}
    </div>
  );
}
