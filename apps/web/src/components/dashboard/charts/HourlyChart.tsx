import { MousePointer2, Pin, X } from "lucide-react";
import { useState } from "react";
import { formatNumber } from "@/hooks/analytics";

export interface HourlyChartProps {
  data: { hour: number; count: number }[];
}

export function HourlyChart({ data }: HourlyChartProps) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="grid h-[236px] place-items-center rounded-xl border border-dashed border-[#dce3de] bg-[#fafcfb] text-sm text-[#718078] dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
        No hourly activity in this period
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
              Volume
            </p>
            <p className="text-xl font-semibold tabular-nums text-[#203b32] dark:text-dark-text-primary">
              {formatNumber(totalMessages)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7c8983] dark:text-dark-text-secondary">
              Peak hour
            </p>
            <p className="text-sm font-semibold tabular-nums text-[#0b7a55] dark:text-emerald-300">
              {formatHour(peak.hour)}
            </p>
          </div>
        </div>
        {selectedHour === null ? (
          <span className="flex items-center gap-1.5 rounded-full border border-[#dce3de] bg-[#fafcfb] px-2.5 py-1 text-[10px] font-medium text-[#718078] dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text-secondary">
            <MousePointer2 className="h-3 w-3" />
            Hover or click a bar
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSelectedHour(null)}
            className="flex items-center gap-1.5 rounded-full border border-[#b9d7ca] bg-[#edf6f2] px-2.5 py-1 text-[10px] font-semibold text-[#0b7a55] transition-colors hover:bg-[#e1f0e9] dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            aria-label="Clear pinned hour"
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
        aria-label={`Hourly activity with ${formatNumber(totalMessages)} messages and a peak at ${formatHour(peak.hour)}`}
      >
        <div
          className="pointer-events-none absolute inset-x-0 bottom-7 top-0 flex flex-col justify-between"
          aria-hidden="true"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className="block w-full border-t border-dashed border-[#e4eae6] dark:border-dark-border"
            />
          ))}
        </div>

        {activeData && (
          <div
            className="pointer-events-none absolute z-20 w-40 -translate-x-1/2 rounded-xl border border-[#cfdad4] bg-[#173c31] px-3 py-2.5 text-white shadow-[0_12px_30px_rgba(16,44,36,0.24)]"
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
                <span className="rounded-full bg-[#d18b35] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide">
                  Peak
                </span>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatNumber(activeData.count)}
              <span className="ml-1 text-[10px] font-normal text-emerald-100/70">
                messages
              </span>
            </p>
            <p className="mt-0.5 text-[10px] text-emerald-100/70">
              {totalMessages > 0
                ? ((activeData.count / totalMessages) * 100).toFixed(1)
                : "0"}
              % of activity
            </p>
            <span className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[#173c31]" />
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
                className="group relative flex h-full min-w-0 items-end justify-center rounded-lg outline-none transition-colors hover:bg-[#edf6f2]/70 focus-visible:bg-[#edf6f2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#67ae90] dark:hover:bg-emerald-950/20 dark:focus-visible:bg-emerald-950/30"
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
                      ? "bg-gradient-to-b from-[#e5a352] to-[#c87827]"
                      : "bg-gradient-to-b from-[#36b98a] to-[#0b7a55]"
                  } ${
                    activeHour !== null && !isActive
                      ? "opacity-40"
                      : "opacity-100"
                  } ${isActive ? "drop-shadow-[0_5px_8px_rgba(11,122,85,0.2)]" : ""}`}
                  style={{
                    height: `${Math.max(height, hour.count > 0 ? 2 : 1)}%`,
                  }}
                  aria-hidden="true"
                />
                {(hour.hour % 6 === 0 || hour.hour === 23) && (
                  <span className="absolute top-[calc(100%+7px)] text-[10px] tabular-nums text-[#8a9690] dark:text-dark-text-tertiary">
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

export default HourlyChart;
