import { dayjs } from "@wateaminbox/shared";
import { CalendarClock, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** Mirror of the server-side minimum lead time, with UI slack on top. */
const MIN_LEAD_MS = 60_000;

interface ScheduleMessagePopoverProps {
  onSchedule: (scheduledAtIso: string) => void;
  isSubmitting: boolean;
}

function toLocalInputValue(value: dayjs.Dayjs): string {
  return value.format("YYYY-MM-DDTHH:mm");
}

interface Preset {
  labelKey: string;
  label: string;
  value: () => dayjs.Dayjs;
}

const PRESETS: Preset[] = [
  {
    labelKey: "broadcasts.presets.inOneHour",
    label: "In 1 hour",
    value: () => dayjs().add(1, "hour"),
  },
  {
    labelKey: "broadcasts.presets.tomorrow9",
    label: "Tomorrow 9:00",
    value: () => dayjs().add(1, "day").hour(9).minute(0),
  },
  {
    labelKey: "broadcasts.presets.nextWeek9",
    label: "Next week 9:00",
    value: () => dayjs().add(7, "day").hour(9).minute(0),
  },
];

/**
 * Pick a future date/time for a scheduled message. Times are entered in the
 * user's local timezone and converted to UTC ISO for the API.
 */
export function ScheduleMessagePopover({
  onSchedule,
  isSubmitting,
}: ScheduleMessagePopoverProps) {
  const { t } = useTranslation();

  const [value, setValue] = useState(() =>
    toLocalInputValue(dayjs().add(1, "hour").second(0)),
  );
  const [error, setError] = useState<string | null>(null);
  const minValue = useMemo(
    () => toLocalInputValue(dayjs().add(1, "minute")),
    [],
  );

  const handleConfirm = () => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      setError(t("chat.invalidDateTime", "Enter a valid date and time"));
      return;
    }
    if (parsed.getTime() - Date.now() < MIN_LEAD_MS) {
      setError(
        t("chat.pickFutureTime", "Pick a time at least a minute from now"),
      );
      return;
    }
    setError(null);
    onSchedule(parsed.toISOString());
  };

  return (
    <div className="absolute bottom-full right-0 z-30 mb-3 w-72 origin-bottom-right animate-in rounded-2xl border border-black/[0.07] bg-white p-3 shadow-[0_12px_36px_rgba(11,20,26,0.18)] fade-in-0 zoom-in-95 duration-150 dark:border-white/[0.08] dark:bg-dark-elevated dark:shadow-black/40">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#3b4a54] dark:text-dark-text-primary">
        <CalendarClock
          className="size-4 text-[#008069] dark:text-emerald-300"
          aria-hidden="true"
        />
        {t("chat.scheduleMessage", "Schedule message")}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setValue(toLocalInputValue(preset.value().second(0)));
              setError(null);
            }}
            className="rounded-full border border-black/[0.08] px-2.5 py-1 text-xs font-medium text-[#54656f] transition-colors hover:bg-[#f0f2f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/35 dark:border-white/[0.1] dark:text-dark-text-secondary dark:hover:bg-white/[0.06]"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-[#667781] dark:text-dark-text-tertiary">
          Send at ({Intl.DateTimeFormat().resolvedOptions().timeZone})
        </span>
        <input
          type="datetime-local"
          value={value}
          min={minValue}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          className="mt-1 block w-full rounded-lg border border-black/[0.1] bg-white px-2.5 py-1.5 text-sm text-[#111b21] outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]/40 dark:border-white/[0.1] dark:bg-dark-tertiary dark:text-dark-text-primary"
          aria-label={t("chat.scheduledSendTime", "Scheduled send time")}
        />
      </label>

      {error && (
        <p
          className="mt-1.5 text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isSubmitting}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#00a884] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#008f72] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/45"
      >
        {isSubmitting && (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        )}
        Schedule
      </button>
    </div>
  );
}
