import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatDate, formatNumber } from "@/hooks/analytics";
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

export interface MessageChartProps {
  data: { date: string; sent: number; received: number }[];
}

export function MessageChart({ data }: MessageChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(chartBox.width);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [visibleSeries, setVisibleSeries] = useState({
    outbound: true,
    inbound: true,
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
  }, [data.length]);

  if (data.length === 0) {
    return <ChartEmptyState message="No message activity in this period" />;
  }

  const displayData = data;
  const maxValue = getNiceMax(
    displayData.flatMap((day) => [day.sent, day.received]),
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
  const sentPoints = getLinePoints(
    displayData.map((day) => day.sent),
    maxValue,
    responsiveChartBox,
  );
  const receivedPoints = getLinePoints(
    displayData.map((day) => day.received),
    maxValue,
    responsiveChartBox,
  );
  const labelIndexes = getLabelIndexes(displayData.length);
  const totalSent = displayData.reduce((total, day) => total + day.sent, 0);
  const totalReceived = displayData.reduce(
    (total, day) => total + day.received,
    0,
  );
  const hoveredDay = hoveredIndex === null ? null : displayData[hoveredIndex];
  const hoveredX = hoveredIndex === null ? 0 : sentPoints[hoveredIndex].x;

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
          <Metric label="Sent" value={totalSent} color="emerald" />
          <Metric label="Received" value={totalReceived} color="blue" />
        </div>
        <div className="flex items-center gap-1 text-[11px] font-medium text-[#718078] dark:text-dark-text-secondary">
          <LegendDot
            color="bg-[#0b7a55]"
            label="Outbound"
            active={visibleSeries.outbound}
            onToggle={() =>
              setVisibleSeries((series) => ({
                ...series,
                outbound: !series.outbound,
              }))
            }
          />
          <LegendDot
            color="bg-[#4185c5]"
            label="Inbound"
            active={visibleSeries.inbound}
            onToggle={() =>
              setVisibleSeries((series) => ({
                ...series,
                inbound: !series.inbound,
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
          aria-label={`Message trend showing ${formatNumber(totalSent)} sent and ${formatNumber(totalReceived)} received messages`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
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
                  {formatAxisNumber(tick)}
                </text>
              </g>
            );
          })}

          {visibleSeries.outbound && (
            <>
              <path
                d={getAreaPath(sentPoints, chartBaseline)}
                fill="url(#message-sent-area)"
              />
              <path
                d={getSmoothPath(sentPoints)}
                fill="none"
                stroke="#0b7a55"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
          {visibleSeries.inbound && (
            <>
              <path
                d={getAreaPath(receivedPoints, chartBaseline)}
                fill="url(#message-received-area)"
              />
              <path
                d={getSmoothPath(receivedPoints)}
                fill="none"
                stroke="#4185c5"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}

          {displayData.map((day, index) =>
            labelIndexes.has(index) ? (
              <text
                key={day.date}
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
              {visibleSeries.outbound && (
                <circle
                  cx={hoveredX}
                  cy={sentPoints[hoveredIndex].y}
                  r="5"
                  fill="#0b7a55"
                  stroke="white"
                  strokeWidth="2"
                />
              )}
              {visibleSeries.inbound && (
                <circle
                  cx={hoveredX}
                  cy={receivedPoints[hoveredIndex].y}
                  r="5"
                  fill="#4185c5"
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

        {hoveredDay && (visibleSeries.outbound || visibleSeries.inbound) && (
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
            {visibleSeries.outbound && (
              <p className="flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#0b7a55]" />
                  Outbound
                </span>
                <strong className="tabular-nums text-[#075c41] dark:text-emerald-300">
                  {formatNumber(hoveredDay.sent)}
                </strong>
              </p>
            )}
            {visibleSeries.inbound && (
              <p className="mt-1 flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#4185c5]" />
                  Inbound
                </span>
                <strong className="tabular-nums text-[#326fa8] dark:text-blue-300">
                  {formatNumber(hoveredDay.received)}
                </strong>
              </p>
            )}
            <div className="mt-1.5 border-t border-[#e3e9e5] pt-1.5 dark:border-dark-border">
              <p className="flex items-center justify-between gap-4 text-[#617169] dark:text-dark-text-secondary">
                <span>Total</span>
                <strong className="tabular-nums text-[#31463e] dark:text-dark-text-primary">
                  {formatNumber(hoveredDay.sent + hoveredDay.received)}
                </strong>
              </p>
            </div>
          </div>
        )}
      </div>
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

function LegendDot({
  color,
  label,
  active,
  onToggle,
}: {
  color: string;
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
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className={active ? "" : "line-through"}>{label}</span>
    </button>
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
