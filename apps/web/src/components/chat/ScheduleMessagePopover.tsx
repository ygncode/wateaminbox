import { dayjs } from "@wateaminbox/shared";
import { CalendarClock, Loader2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsSmallMobile } from "@/hooks/ui";
import { cn } from "@/lib/utils";
import { resolveScheduledAt } from "./composer-schedule";

interface ScheduleMessagePopoverProps {
  onSchedule: (scheduledAtIso: string) => void;
  isSubmitting: boolean;
  /** Dismiss without scheduling: backdrop, close control, or Escape. */
  onClose: () => void;
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

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';

/**
 * Pick a future date/time for a scheduled message. Times are entered in the
 * user's local timezone and converted to UTC ISO for the API.
 *
 * Two presentations, one component:
 *
 * - Below `sm` it is a modal bottom sheet with a scrim and an explicit close
 *   control. A 288px popover anchored to a 36px icon inside the composer is
 *   unusable on a phone: it overhangs the viewport, its dismiss gesture is an
 *   outside tap onto a composer that will take the tap itself, and the
 *   keyboard that opens for the time field covers it.
 * - From `sm` up it stays the anchored popover it always was, dismissed by
 *   clicking outside (the composer owns that, via `useClickOutside`).
 *
 * `position: fixed` here resolves against the nearest transformed ancestor,
 * which on the phone layout is the sliding conversation view - that box is the
 * conversation area, which is exactly the region the sheet should cover.
 */
export function ScheduleMessagePopover({
  onSchedule,
  isSubmitting,
  onClose,
}: ScheduleMessagePopoverProps) {
  const { t } = useTranslation();
  const isSheet = useIsSmallMobile();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [value, setValue] = useState(() =>
    toLocalInputValue(dayjs().add(1, "hour").second(0)),
  );
  const [error, setError] = useState<string | null>(null);
  const minValue = useMemo(
    () => toLocalInputValue(dayjs().add(1, "minute")),
    [],
  );

  // Move focus in on open and hand it back to the trigger on close, so the
  // sheet is reachable and dismissible from the keyboard alone.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    // Never remember something inside the dialog: effects are re-run on a
    // StrictMode remount, and the second pass would otherwise capture the
    // panel and later "restore" focus to a node that is being removed.
    if (
      active &&
      active !== document.body &&
      !panelRef.current?.contains(active)
    ) {
      restoreFocusRef.current = active;
    }
    panelRef.current?.focus();
    return () => {
      const target = restoreFocusRef.current;
      // The trigger is unmounted too when the composer is cleared; focusing a
      // detached node would silently drop focus to the document.
      if (target?.isConnected) target.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Deliberately no `defaultPrevented` guard. Whenever this sheet is
      // mounted it is the innermost dismissable layer, so Escape is its own.
      // Deferring to an already-handled event broke the attachment preview
      // dialog: that Radix dialog vetoes its own dismissal while this sheet is
      // open (see AttachmentPreviewDialog), and the veto marks the event
      // handled *before* this listener runs - so the sheet skipped its close
      // too and Escape did nothing at all with both layers on screen.
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      // Only the sheet is modal, so only the sheet traps Tab; the anchored
      // popover deliberately lets focus continue into the composer.
      if (event.key !== "Tab" || !isSheet) return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSheet, onClose]);

  const handleConfirm = () => {
    const result = resolveScheduledAt(value);
    if (!result.ok) {
      setError(
        result.reason === "invalid"
          ? t("chat.invalidDateTime", "Enter a valid date and time")
          : t("chat.pickFutureTime", "Pick a time at least a minute from now"),
      );
      return;
    }
    setError(null);
    onSchedule(result.iso);
  };

  return (
    <>
      {/* Scrim: sheet only. The anchored popover is dismissed by the
          composer's outside-click handler instead. */}
      <div
        className="fixed inset-0 z-40 bg-black/45 sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={isSheet || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-black/[0.07] bg-white p-4 shadow-[0_-12px_36px_rgba(11,20,26,0.18)] outline-none dark:border-white/[0.08] dark:bg-dark-elevated dark:shadow-black/40",
          // The home indicator sits under the confirm button on a sheet.
          "pb-[max(env(safe-area-inset-bottom),1rem)]",
          // From `sm` up, back to the anchored popover.
          "sm:absolute sm:inset-x-auto sm:bottom-full sm:right-0 sm:z-30 sm:mb-3 sm:max-h-none sm:w-72 sm:origin-bottom-right sm:rounded-2xl sm:border sm:p-3 sm:pb-3 sm:shadow-[0_12px_36px_rgba(11,20,26,0.18)] sm:animate-in sm:fade-in-0 sm:zoom-in-95 sm:duration-150",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p
            id={titleId}
            className="flex items-center gap-2 text-sm font-semibold text-[#3b4a54] dark:text-dark-text-primary"
          >
            <CalendarClock
              className="size-4 text-[#008069] dark:text-emerald-300"
              aria-hidden="true"
            />
            {t("chat.scheduleMessage", "Schedule message")}
          </p>
          {/* An outside tap is not a reliable dismissal on a phone - it lands
              on the composer, which takes it. The sheet says how to leave. */}
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 grid size-11 shrink-0 touch-manipulation place-items-center rounded-full text-[#54656f] transition-colors hover:bg-black/[0.055] active:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-dark-text-secondary dark:hover:bg-white/[0.06] sm:hidden"
            aria-label={t("common.close", "Close")}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2 sm:gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setValue(toLocalInputValue(preset.value().second(0)));
                setError(null);
              }}
              className="min-h-11 touch-manipulation rounded-full border border-black/[0.08] px-4 text-sm font-medium text-[#54656f] transition-colors hover:bg-[#f0f2f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/35 dark:border-white/[0.1] dark:text-dark-text-secondary dark:hover:bg-white/[0.06] sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs"
            >
              {t(preset.labelKey, preset.label)}
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-[#667781] dark:text-dark-text-tertiary">
            {t("broadcasts.sendAt", {
              defaultValue: "Send at ({{timezone}})",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}
          </span>
          {/* 16px on touch: anything smaller makes iOS Safari zoom the page
              when the field takes focus, which strands the sheet off-screen. */}
          <input
            type="datetime-local"
            value={value}
            min={minValue}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            className="mt-1 block h-11 w-full rounded-lg border border-black/[0.1] bg-white px-2.5 text-base text-[#111b21] outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]/40 dark:border-white/[0.1] dark:bg-dark-tertiary dark:text-dark-text-primary sm:h-auto sm:py-1.5 sm:text-sm"
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
          className="mt-3 flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-[#00a884] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#008f72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/45 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-2"
        >
          {isSubmitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          {t("broadcasts.schedule", "Schedule")}
        </button>
      </div>
    </>
  );
}
