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
      <DialogContent className="mx-3 w-[calc(100vw-1.5rem)] max-w-md rounded-2xl border-[#d7e0da] p-0 dark:border-dark-border sm:w-full">
        <DialogHeader className="border-b border-[#e3e9e5] px-5 py-4 pr-12 text-left dark:border-dark-border">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e2f1e9] text-[#087654] dark:bg-emerald-950/60 dark:text-emerald-300">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="text-base">Edit schedule</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5">
                Change when this broadcast starts. Its message, attachment, and
                snapshotted recipients stay exactly the same.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-5 py-1">
          <div
            className="flex flex-wrap gap-1.5"
            aria-label="Schedule shortcuts"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => choosePreset(dayjs().add(1, "hour"))}
            >
              In 1 hour
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                choosePreset(dayjs().add(1, "day").hour(9).minute(0))
              }
            >
              Tomorrow 9:00
            </Button>
          </div>

          <label htmlFor="broadcast-reschedule-at" className="block">
            <span className="text-xs font-semibold text-[#40554c] dark:text-dark-text-primary">
              New start time
            </span>
            <span className="mt-0.5 block text-[11px] text-[#718078] dark:text-dark-text-secondary">
              Times are shown in {timezone}.
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
              className="mt-2 block w-full rounded-lg border border-[#cfd9d3] bg-white px-3 py-2 text-sm text-[#172a23] outline-none transition focus:border-[#0b7a55] focus:ring-2 focus:ring-[#0b7a55]/20 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary"
            />
            {error && (
              <span
                id="broadcast-reschedule-error"
                className="mt-1.5 block text-xs text-red-600 dark:text-red-400"
                role="alert"
              >
                {error}
              </span>
            )}
          </label>

          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-200">
            Rescheduling is available only until the first recipient begins
            processing. If sending starts while this dialog is open, the update
            will be safely rejected.
          </p>
        </div>

        <DialogFooter className="gap-2 border-t border-[#e3e9e5] px-5 py-4 dark:border-dark-border sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Keep current time
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="gap-2 bg-[#0b7a55] text-white hover:bg-[#096747]"
          >
            {isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Save new time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
