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
    className: "border-info/30 bg-info-soft text-info",
    dotClassName: "bg-info",
  },
  running: {
    labelKey: "broadcasts.status.running",
    label: "Sending",
    className: "border-accent/30 bg-accent-soft text-accent",
    dotClassName: "bg-primary",
    pulse: true,
  },
  completed: {
    labelKey: "broadcasts.status.completed",
    label: "Completed",
    className: "border-accent/30 bg-accent-soft text-accent",
    dotClassName: "bg-primary",
  },
  completed_with_errors: {
    labelKey: "broadcasts.status.partiallySent",
    label: "Partially sent",
    className: "border-warning/30 bg-warning-soft text-warning",
    dotClassName: "bg-warning",
  },
  canceled: {
    labelKey: "broadcasts.status.canceled",
    label: "Canceled",
    className: "border-line bg-muted text-fg-muted",
    dotClassName: "bg-fg-subtle",
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
