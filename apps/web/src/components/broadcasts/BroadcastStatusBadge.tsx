import type { BulkJobStatus } from "@wateaminbox/shared";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const STATUS_CONFIG: Record<
  BulkJobStatus,
  {
    labelKey: string;
    label: string;
    className: string;
    dotClassName: string;
    pulse?: boolean;
  }
> = {
  scheduled: {
    labelKey: "broadcasts.status.scheduled",
    label: "Scheduled",
    className:
      "border-sky-200/70 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-300",
    dotClassName: "bg-sky-500 dark:bg-sky-300",
  },
  running: {
    labelKey: "broadcasts.status.running",
    label: "Sending",
    className:
      "border-emerald-200 bg-emerald-50 text-[#087654] dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    dotClassName: "bg-[#16a06f] dark:bg-emerald-300",
    pulse: true,
  },
  completed: {
    labelKey: "broadcasts.status.completed",
    label: "Completed",
    className:
      "border-emerald-200/80 bg-[#edf7f2] text-[#087654] dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300",
    dotClassName: "bg-[#24a778] dark:bg-emerald-300",
  },
  completed_with_errors: {
    labelKey: "broadcasts.status.partiallySent",
    label: "Partially sent",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300",
    dotClassName: "bg-amber-500 dark:bg-amber-300",
  },
  canceled: {
    labelKey: "broadcasts.status.canceled",
    label: "Canceled",
    className:
      "border-[#dfe5e1] bg-[#f1f3f2] text-[#65736d] dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary",
    dotClassName: "bg-[#8b9891] dark:bg-dark-text-tertiary",
  },
};

interface BroadcastStatusBadgeProps {
  status: BulkJobStatus;
  className?: string;
}

/** Restrained status badge shared by list and detail views. */
export function BroadcastStatusBadge({
  status,
  className,
}: BroadcastStatusBadgeProps) {
  const { t } = useTranslation();

  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-4",
        config.className,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {config.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
              config.dotClassName,
            )}
          />
        )}
        <span
          className={cn(
            "relative h-1.5 w-1.5 rounded-full",
            config.dotClassName,
          )}
        />
      </span>
      {t(config.labelKey, config.label)}
    </span>
  );
}
