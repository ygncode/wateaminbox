import { MousePointer2, Pin, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/hooks/analytics";

export interface HourlyChartProps {
  data: { hour: number; count: number }[];
}

export function HourlyChart({ data }: HourlyChartProps) {
  const { t } = useTranslation();

  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="grid h-[236px] place-items-center rounded-xl border border-dashed border-line bg-subtle text-sm text-fg-muted">
        {t(
          "dashboard.charts.noHourlyActivity",
          "No hourly activity in this period",
        )}
      </div>
    );
  }

  const maxValue = Math.max(...data.map((hour) => hour.count), 1);
  const totalMessages = data.reduce((total, hour) => total + hour.count, 0);
  const peak = data.reduce(
    (highest, hour) => (hour.count > highest.count ? hour : highest),
    data[0],
  );
  const activeHour = hoveredHour ?? selectedHour;
  const activeIndex = data.findIndex((hour) => hour.hour === activeHour);
  const activeData = activeIndex >= 0 ? data[activeIndex] : null;
  const activePercent = activeData ? activeData.count / maxValue : 0;
  const toggleSelectedHour = (hour: number) => {
    setSelectedHour((current) => (current === hour ? null : hour));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
              Volume
            </p>
            <p className="text-xl font-semibold tabular-nums text-fg">
              {formatNumber(totalMessages)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
              {t("dashboard.charts.peakHour", "Peak hour")}
            </p>
            <p className="text-sm font-semibold tabular-nums text-accent">
              {formatHour(peak.hour)}
            </p>
          </div>
        </div>
        {selectedHour === null ? (
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-[10px] font-medium text-fg-muted">
            <MousePointer2 className="h-3 w-3" />
            {t("dashboard.charts.hoverHint", "Hover or click a bar")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSelectedHour(null)}
            className="flex items-center gap-1.5 rounded-full border border-line-strong bg-subtle px-2.5 py-1 text-[10px] font-semibold text-accent transition-colors hover:bg-accent-soft"
            aria-label={t(
              "dashboard.charts.clearPinnedHour",
              "Clear pinned hour",
            )}
          >
            <Pin className="h-3 w-3" />
            {formatHour(selectedHour)} pinned
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div
        className="relative h-[220px] w-full"
        role="group"
        aria-label={t("dashboard.charts.hourlyAria", {
          messages: formatNumber(totalMessages),
          hour: formatHour(peak.hour),
        })}
      >
        <div
          className="pointer-events-none absolute inset-x-0 bottom-7 top-0 flex flex-col justify-between"
          aria-hidden="true"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className="block w-full border-t border-dashed border-line"
            />
          ))}
        </div>

        {activeData && (
          <div
            className="pointer-events-none absolute z-20 w-40 -translate-x-1/2 rounded-xl border border-line-strong bg-primary px-3 py-2.5 text-on-primary shadow-lg"
            style={{
              left: `${Math.min(92, Math.max(8, ((activeIndex + 0.5) / data.length) * 100))}%`,
              bottom: `${40 + activePercent * 160}px`,
            }}
            role="status"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                {formatHour(activeData.hour)}
              </span>
              {activeData.hour === peak.hour && (
                <span className="rounded-full bg-warning px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide">
                  Peak
                </span>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatNumber(activeData.count)}
              <span className="ms-1 text-[10px] font-normal text-white/70">
                messages
              </span>
            </p>
            <p className="mt-0.5 text-[10px] text-white/70">
              {totalMessages > 0
                ? ((activeData.count / totalMessages) * 100).toFixed(1)
                : "0"}
              % of activity
            </p>
            <span className="absolute start-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rotate-45 bg-primary" />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-7 top-0 grid grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-0.5 sm:gap-1 lg:gap-1.5">
          {data.map((hour) => {
            const height = (hour.count / maxValue) * 100;
            const isPeak = hour.hour === peak.hour;
            const isActive = activeHour === hour.hour;

            return (
              <button
                key={hour.hour}
                type="button"
                className="group relative flex h-full min-w-0 items-end justify-center rounded-lg outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={`${formatHour(hour.hour)}: ${hour.count} messages`}
                aria-pressed={selectedHour === hour.hour}
                onMouseEnter={() => setHoveredHour(hour.hour)}
                onMouseLeave={() => setHoveredHour(null)}
                onFocus={() => setHoveredHour(hour.hour)}
                onBlur={() => setHoveredHour(null)}
                onClick={() => toggleSelectedHour(hour.hour)}
              >
                <span
                  className={`block w-[42%] min-w-1 max-w-5 rounded-t-full transition-[height,opacity,filter] ${
                    isPeak
                      ? "bg-gradient-to-b from-warning to-warning"
                      : "bg-gradient-to-b from-primary to-primary"
                  } ${
                    activeHour !== null && !isActive
                      ? "opacity-40"
                      : "opacity-100"
                  } ${isActive ? "drop-shadow-md" : ""}`}
                  style={{
                    height: `${Math.max(height, hour.count > 0 ? 2 : 1)}%`,
                  }}
                  aria-hidden="true"
                />
                {(hour.hour % 6 === 0 || hour.hour === 23) && (
                  <span className="absolute top-[calc(100%+7px)] text-[10px] tabular-nums text-fg-muted">
                    {String(hour.hour).padStart(2, "0")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatHour(hour: number): string {
  const normalized = hour % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const displayHour = normalized % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}
