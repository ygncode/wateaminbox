import { dayjs } from "@wateaminbox/shared";
import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  chartBox,
  formatAxisNumber,
  getAreaPath,
  getGridTicks,
  getLabelIndexes,
  getLinePoints,
  getNiceMax,
  getSmoothPath,
} from "./chart-utils";
import { useTranslation } from "react-i18next";

export interface ResolutionTrendData {
  date: string;
  resolvedCount: number;
  averageResolutionMinutes: number;
  slaComplianceRate: number;
}

interface ResolutionTrendChartProps {
  data: ResolutionTrendData[];
}

/**
 * Average case-resolution time over the selected range, bucketed by
 * `resolved_at` (see getCaseResolutionTrend). No single SLA-target
 * threshold line is drawn - unlike response time, the resolution target
 * differs by conversation kind (direct/group), so there's no one number to
 * overlay here; compliance is instead conveyed per-point via dot color.
 */
export function ResolutionTrendChart({ data }: ResolutionTrendChartProps) {
  const { t } = useTranslation();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(chartBox.width);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const updateWidth = (width: number) => {
      if (width > 0) setChartWidth(Math.round(width));
    };

    updateWidth(container.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      updateWidth(entry.contentRect.width);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  if (data.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-[#dce3de] bg-[#fafcfb] text-sm text-[#718078] dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
        {t(
          "dashboard.charts.noResolutionTrend",
          "No resolution trend in this period",
        )}
      </div>
    );
  }

  const displayData = data;
  const maxValue = getNiceMax(
    displayData.map((day) => day.averageResolutionMinutes),
  );
  const responsiveChartBox = { ...chartBox, width: chartWidth };
  const plotWidth =
    responsiveChartBox.width -
    responsiveChartBox.left -
    responsiveChartBox.right;
  const plotHeight =
    responsiveChartBox.height -
    responsiveChartBox.top -
    responsiveChartBox.bottom;
  const chartBaseline = responsiveChartBox.top + plotHeight;
  const points = getLinePoints(
    displayData.map((day) => day.averageResolutionMinutes),
    maxValue,
    responsiveChartBox,
  );
  const labelIndexes = getLabelIndexes(displayData.length);
  const hoveredDay = hoveredIndex === null ? null : displayData[hoveredIndex];
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (displayData.length === 0) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX =
      ((event.clientX - bounds.left) / bounds.width) * responsiveChartBox.width;
    const index = Math.round(
      ((pointerX - responsiveChartBox.left) / plotWidth) *
        (displayData.length - 1),
    );
    setHoveredIndex(Math.max(0, Math.min(displayData.length - 1, index)));
  };

  return (
    <div ref={chartContainerRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${responsiveChartBox.width} ${responsiveChartBox.height}`}
        className="block h-[220px] w-full touch-none overflow-visible"
        role="img"
        aria-label={t(
          "dashboard.charts.avgResolutionTrendAria",
          "Average resolution-time trend",
        )}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="resolution-time-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0b7a55" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0b7a55" stopOpacity="0" />
          </linearGradient>
        </defs>

        {getGridTicks(maxValue).map((tick, index) => {
          const y = responsiveChartBox.top + (index / 4) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={responsiveChartBox.left}
                x2={responsiveChartBox.width - responsiveChartBox.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-[#e4eae6] dark:text-dark-border"
                strokeDasharray="3 5"
              />
              <text
                x={responsiveChartBox.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-[#8a9690] text-[10px] dark:fill-dark-text-tertiary"
              >
                {formatAxisNumber(tick)}m
              </text>
            </g>
          );
        })}

        <path
          d={getAreaPath(points, chartBaseline)}
          fill="url(#resolution-time-area)"
        />
        <path
          d={getSmoothPath(points)}
          fill="none"
          stroke="#0b7a55"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {displayData.map((day, index) => (
          <g key={day.date}>
            <circle
              cx={points[index].x}
              cy={points[index].y}
              r="4"
              fill={getComplianceColor(day.slaComplianceRate)}
              stroke="white"
              strokeWidth="2"
            />
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

        {hoveredDay && hoveredPoint && (
          <g aria-hidden="true">
            <line
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={responsiveChartBox.top}
              y2={chartBaseline}
              stroke="currentColor"
              className="text-[#aab5af] dark:text-dark-text-tertiary"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="6"
              fill={getComplianceColor(hoveredDay.slaComplianceRate)}
              stroke="white"
              strokeWidth="2.5"
            />
          </g>
        )}

        <rect
          x={responsiveChartBox.left}
          y={responsiveChartBox.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
        />
      </svg>

      {hoveredDay && hoveredPoint && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-44 -translate-x-1/2 rounded-lg border border-[#dce3de] bg-white/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-dark-border dark:bg-dark-secondary/95"
          style={{
            left: Math.min(
              Math.max(96, hoveredPoint.x),
              Math.max(96, chartWidth - 96),
            ),
          }}
          role="status"
        >
          <p className="mb-1.5 font-semibold text-[#31463e] dark:text-dark-text-primary">
            {dayjs(hoveredDay.date).format("MMM D, YYYY")}
          </p>
          <p className="flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#0b7a55]" />
              {t("dashboard.charts.averageResolution", "Average resolution")}
            </span>
            <strong className="tabular-nums text-[#075c41] dark:text-emerald-300">
              {formatMinutes(hoveredDay.averageResolutionMinutes, t)}
            </strong>
          </p>
          <p className="mt-1 flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
            <span>{t("dashboard.charts.slaCompliance", "SLA compliance")}</span>
            <strong
              className="tabular-nums"
              style={{
                color: getComplianceColor(hoveredDay.slaComplianceRate),
              }}
            >
              {Math.round(hoveredDay.slaComplianceRate)}%
            </strong>
          </p>
          <p className="mt-1 flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
            <span>{t("dashboard.charts.resolved", "Resolved")}</span>
            <strong className="tabular-nums text-[#31463e] dark:text-dark-text-primary">
              {hoveredDay.resolvedCount.toLocaleString()}
            </strong>
          </p>
        </div>
      )}
    </div>
  );
}

function getComplianceColor(rate: number): string {
  if (rate >= 90) return "#0b7a55";
  if (rate >= 70) return "#d18b35";
  return "#cf5a5a";
}

/** Optional translator keeps this usable outside a React render. */
type MinutesTranslate = (
  key: string,
  options: { defaultValue: string } & Record<string, unknown>,
) => string;

const englishMinutes: MinutesTranslate = (_key, options) =>
  options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    String(options[name] ?? ""),
  );

function formatMinutes(
  minutes: number,
  t: MinutesTranslate = englishMinutes,
): string {
  if (minutes < 1)
    return t("duration.lessThanAMinute", { defaultValue: "< 1 min" });
  if (minutes < 60)
    return t("duration.minutes", {
      defaultValue: "{{count}} min",
      count: Math.round(minutes),
    });
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0
    ? t("duration.hoursMinutes", {
        defaultValue: "{{hours}}h {{minutes}}m",
        hours,
        minutes: mins,
      })
    : t("duration.hours", { defaultValue: "{{hours}}h", hours });
}

export default ResolutionTrendChart;
