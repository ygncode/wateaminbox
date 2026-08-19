import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatDate, formatNumber } from "@/hooks/analytics";
import {
  chartBox,
  getAreaPath,
  getLabelIndexes,
  getLinePoints,
  getSmoothPath,
} from "./chart-utils";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(chartBox.width);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [visibleSeries, setVisibleSeries] = useState({
    engagement: true,
    response: true,
  });

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
      <div className="grid h-[240px] place-items-center rounded-xl border border-dashed border-[#dce3de] bg-[#fafcfb] text-sm text-[#718078] dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
        {t(
          "dashboard.charts.noEngagementTrend",
          "No engagement trend in this period",
        )}
      </div>
    );
  }

  const displayData = data;
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
  const scorePoints = getLinePoints(
    displayData.map((day) => day.engagementScore),
    100,
    responsiveChartBox,
  );
  const responsePoints = getLinePoints(
    displayData.map((day) => day.responseRate),
    100,
    responsiveChartBox,
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
  const hoveredDay = hoveredIndex === null ? null : displayData[hoveredIndex];
  const hoveredX = hoveredIndex === null ? 0 : scorePoints[hoveredIndex].x;

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
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
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
              {t("dashboard.charts.averageScore", "Average score")}
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
              {t("dashboard.charts.activeTouches", "Active touches")}
            </p>
            <p className="text-sm font-semibold tabular-nums text-[#31463e] dark:text-dark-text-primary">
              {formatNumber(activeContacts)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-medium text-[#718078] dark:text-dark-text-secondary">
          <Legend
            swatch="bg-[#0b7a55]"
            label={t("dashboard.charts.engagement", "Engagement")}
            active={visibleSeries.engagement}
            onToggle={() =>
              setVisibleSeries((series) => ({
                ...series,
                engagement: !series.engagement,
              }))
            }
          />
          <Legend
            swatch="border-t-2 border-dashed border-[#d18b35]"
            label={t("dashboard.charts.response", "Response")}
            active={visibleSeries.response}
            onToggle={() =>
              setVisibleSeries((series) => ({
                ...series,
                response: !series.response,
              }))
            }
          />
        </div>
      </div>

      <div ref={chartContainerRef} className="relative w-full">
        <svg
          viewBox={`0 0 ${responsiveChartBox.width} ${responsiveChartBox.height}`}
          className="block h-[220px] w-full touch-none overflow-visible"
          role="img"
          aria-label={`Engagement trend with an average score of ${averageScore} out of 100`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="engagement-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0b7a55" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0b7a55" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect
            x={responsiveChartBox.left}
            y={responsiveChartBox.top}
            width={plotWidth}
            height={plotHeight * 0.3}
            fill="#e8f4ee"
            className="dark:fill-emerald-950/20"
            rx="8"
          />
          {[100, 75, 50, 25, 0].map((tick, index) => {
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
                  {tick}
                </text>
              </g>
            );
          })}

          {visibleSeries.engagement && (
            <>
              <path
                d={getAreaPath(scorePoints, chartBaseline)}
                fill="url(#engagement-area)"
              />
              <path
                d={getSmoothPath(scorePoints)}
                fill="none"
                stroke="#0b7a55"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
          {visibleSeries.response && (
            <path
              d={getSmoothPath(responsePoints)}
              fill="none"
              stroke="#d18b35"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="6 5"
            />
          )}

          {displayData.map((day, index) =>
            labelIndexes.has(index) ? (
              <text
                key={day.date}
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
            ) : null,
          )}

          {hoveredDay && hoveredIndex !== null && (
            <g aria-hidden="true">
              <line
                x1={hoveredX}
                x2={hoveredX}
                y1={responsiveChartBox.top}
                y2={chartBaseline}
                stroke="currentColor"
                className="text-[#aab5af] dark:text-dark-text-tertiary"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              {visibleSeries.engagement && (
                <circle
                  cx={hoveredX}
                  cy={scorePoints[hoveredIndex].y}
                  r="5"
                  fill="#0b7a55"
                  stroke="white"
                  strokeWidth="2"
                />
              )}
              {visibleSeries.response && (
                <circle
                  cx={hoveredX}
                  cy={responsePoints[hoveredIndex].y}
                  r="5"
                  fill="#d18b35"
                  stroke="white"
                  strokeWidth="2"
                />
              )}
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

        {hoveredDay && (visibleSeries.engagement || visibleSeries.response) && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-40 -translate-x-1/2 rounded-lg border border-[#dce3de] bg-white/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-dark-border dark:bg-dark-secondary/95"
            style={{
              left: Math.min(
                Math.max(88, hoveredX),
                Math.max(88, chartWidth - 88),
              ),
            }}
            role="status"
          >
            <p className="mb-1.5 font-semibold text-[#31463e] dark:text-dark-text-primary">
              {formatDate(hoveredDay.date)}
            </p>
            {visibleSeries.engagement && (
              <p className="flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#0b7a55]" />
                  Engagement
                </span>
                <strong className="tabular-nums text-[#075c41] dark:text-emerald-300">
                  {hoveredDay.engagementScore}/100
                </strong>
              </p>
            )}
            {visibleSeries.response && (
              <p className="mt-1 flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#d18b35]" />
                  Response
                </span>
                <strong className="tabular-nums text-[#a76521] dark:text-amber-300">
                  {hoveredDay.responseRate}%
                </strong>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({
  swatch,
  label,
  active,
  onToggle,
}: {
  swatch: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[#f0f4f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7a55]/40 dark:hover:bg-dark-tertiary ${
        active ? "opacity-100" : "opacity-40"
      }`}
      aria-pressed={active}
      aria-label={`${active ? "Hide" : "Show"} ${label.toLowerCase()} series`}
      onClick={onToggle}
    >
      <span className={`h-2 w-4 rounded-full ${swatch}`} />
      <span className={active ? "" : "line-through"}>{label}</span>
    </button>
  );
}

export default EngagementTrendChart;
