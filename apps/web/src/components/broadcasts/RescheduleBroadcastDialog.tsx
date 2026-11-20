import { dayjs } from "@wateaminbox/shared";
import { CalendarClock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RESCHEDULE_MIN_LEAD_MS,
  toLocalScheduleInput,
  validateRescheduleTime,
} from "./broadcast-schedule";
import { useTranslation } from "react-i18next";

interface RescheduleBroadcastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduledAt: string;
  isSubmitting: boolean;
  onSubmit: (scheduledAt: string) => void;
}

export function RescheduleBroadcastDialog({
  open,
  onOpenChange,
  scheduledAt,
  isSubmitting,
  onSubmit,
}: RescheduleBroadcastDialogProps) {
  const { t } = useTranslation();

  const [value, setValue] = useState(() => toLocalScheduleInput(scheduledAt));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(toLocalScheduleInput(scheduledAt));
    setError(null);
  }, [open, scheduledAt]);

  const choosePreset = (next: dayjs.Dayjs) => {
    setValue(next.second(0).millisecond(0).format("YYYY-MM-DDTHH:mm"));
    setError(null);
  };

  const handleSubmit = () => {
    const result = validateRescheduleTime(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSubmit(result.scheduledAt);
  };

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="mx-3 w-[calc(100vw-1.5rem)] max-w-md rounded-2xl border-line p-0 sm:w-full">
        <DialogHeader className="border-b border-line px-5 py-4 pe-12 text-start">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="text-base">
                {t("broadcasts.editSchedule", "Edit schedule")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5">
                {t(
                  "broadcasts.rescheduleHint",
                  "Change when this broadcast starts. Its message, attachment, and snapshotted recipients stay exactly the same.",
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-5 py-1">
          <div
            className="flex flex-wrap gap-1.5"
            aria-label={t("broadcasts.scheduleShortcuts", "Schedule shortcuts")}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => choosePreset(dayjs().add(1, "hour"))}
            >
              {t("broadcasts.presets.inOneHour", "In 1 hour")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                choosePreset(dayjs().add(1, "day").hour(9).minute(0))
              }
            >
              {t("broadcasts.presets.tomorrow9", "Tomorrow 9:00")}
            </Button>
          </div>

          <label htmlFor="broadcast-reschedule-at" className="block">
            <span className="text-xs font-semibold text-fg">
              {t("broadcasts.newStartTime", "New start time")}
            </span>
            <span className="mt-0.5 block text-[11px] text-fg-muted">
              {t("broadcasts.timesShownIn", { timezone })}
            </span>
            <input
              id="broadcast-reschedule-at"
              type="datetime-local"
              value={value}
              min={dayjs(Date.now() + RESCHEDULE_MIN_LEAD_MS).format(
                "YYYY-MM-DDTHH:mm",
              )}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={
                error ? "broadcast-reschedule-error" : undefined
              }
              className="mt-2 block w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-ring/20"
            />
            {error && (
              <span
                id="broadcast-reschedule-error"
                className="mt-1.5 block text-xs text-danger"
                role="alert"
              >
                {error}
              </span>
            )}
          </label>

          <p className="rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs leading-5 text-info">
            {t(
              "broadcasts.rescheduleWindowHint",
              "Rescheduling is available only until the first recipient begins processing. If sending starts while this dialog is open, the update will be safely rejected.",
            )}
          </p>
        </div>

        <DialogFooter className="gap-2 border-t border-line px-5 py-4 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("broadcasts.keepCurrentTime", "Keep current time")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="gap-2 bg-primary text-on-primary hover:bg-primary-hover"
          >
            {isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t("broadcasts.saveNewTime")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
