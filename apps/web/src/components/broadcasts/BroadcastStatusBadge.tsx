import type { BulkJobStatus } from "@wateaminbox/shared";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  BulkJobStatus,
  { label: string; className: string; pulse?: boolean }
> = {
  scheduled: {
    label: "Scheduled",
    className:
      "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  running: {
    label: "Sending",
    className:
      "bg-[#00a884]/10 text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300",
    pulse: true,
  },
  completed: {
    label: "Completed",
    className:
      "bg-[#00a884]/10 text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  // failed OR skipped recipients: the broadcast finished but not everyone
  // snapshotted actually received a send.
  completed_with_errors: {
    label: "Partially sent",
    className:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  canceled: {
    label: "Canceled",
    className:
      "bg-black/[0.05] text-[#667781] dark:bg-white/[0.07] dark:text-dark-text-secondary",
  },
};

interface BroadcastStatusBadgeProps {
  status: BulkJobStatus;
  className?: string;
}

/** Status pill for a broadcast job; running shows a pulsing dot. */
export function BroadcastStatusBadge({
  status,
  className,
}: BroadcastStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        config.className,
        className,
      )}
    >
      {config.pulse && (
        <span
          className="size-1.5 animate-pulse rounded-full bg-[#00a884] dark:bg-emerald-300"
          aria-hidden="true"
        />
      )}
      {config.label}
    </span>
  );
}
