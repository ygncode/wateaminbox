import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { formatDate, formatNumber } from "@/hooks/analytics";
import {
  chartBox,
  getAreaPath,
  getLabelIndexes,
  getLinePoints,
  getSmoothPath,
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
      <div className="grid h-[240px] place-items-center rounded-xl border border-dashed border-line bg-subtle text-sm text-fg-muted">
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
              {t("dashboard.charts.averageScore", "Average score")}
            </p>
            <p className="text-xl font-semibold tabular-nums text-accent">
              {averageScore}
              <span className="ms-0.5 text-xs font-medium text-fg-muted">
                /100
              </span>
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
              {t("dashboard.charts.activeTouches", "Active touches")}
            </p>
            <p className="text-sm font-semibold tabular-nums text-fg">
              {formatNumber(activeContacts)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-medium text-fg-muted">
          <Legend
            swatch="bg-primary"
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
            swatch="border-t-2 border-dashed border-warning"
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
          aria-label={t("dashboard.charts.engagementAria", {
            score: averageScore,
          })}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="engagement-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect
            x={responsiveChartBox.left}
            y={responsiveChartBox.top}
            width={plotWidth}
            height={plotHeight * 0.3}
            fill="var(--accent-soft)"
            className="fill-accent-soft/40"
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
                  className="text-fg-subtle"
                  strokeDasharray="3 5"
                />
                <text
                  x={responsiveChartBox.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-fg-muted text-[10px]"
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
                stroke="var(--chart-1)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
          {visibleSeries.response && (
            <path
              d={getSmoothPath(responsePoints)}
              fill="none"
              stroke="var(--chart-3)"
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
                className="fill-fg-muted text-[10px]"
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
                className="text-fg-subtle"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              {visibleSeries.engagement && (
                <circle
                  cx={hoveredX}
                  cy={scorePoints[hoveredIndex].y}
                  r="5"
                  fill="var(--chart-1)"
                  stroke="white"
                  strokeWidth="2"
                />
              )}
              {visibleSeries.response && (
                <circle
                  cx={hoveredX}
                  cy={responsePoints[hoveredIndex].y}
                  r="5"
                  fill="var(--chart-3)"
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
            className="pointer-events-none absolute top-0 z-10 min-w-40 -translate-x-1/2 rounded-lg border border-line bg-surface/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm"
            style={{
              left: Math.min(
                Math.max(88, hoveredX),
                Math.max(88, chartWidth - 88),
              ),
            }}
            role="status"
          >
            <p className="mb-1.5 font-semibold text-fg">
              {formatDate(hoveredDay.date)}
            </p>
            {visibleSeries.engagement && (
              <p className="flex items-center justify-between gap-4 text-fg-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Engagement
                </span>
                <strong className="tabular-nums text-accent">
                  {hoveredDay.engagementScore}/100
                </strong>
              </p>
            )}
            {visibleSeries.response && (
              <p className="mt-1 flex items-center justify-between gap-4 text-fg-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-warning" />
                  Response
                </span>
                <strong className="tabular-nums text-warning">
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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40  ${
        active ? "opacity-100" : "opacity-40"
      }`}
      aria-pressed={active}
      aria-label={t(
        active ? "dashboard.charts.hideSeries" : "dashboard.charts.showSeries",
        { label: label.toLowerCase() },
      )}
      onClick={onToggle}
    >
      <span className={`h-2 w-4 rounded-full ${swatch}`} />
      <span className={active ? "" : "line-through"}>{label}</span>
    </button>
  );
}
