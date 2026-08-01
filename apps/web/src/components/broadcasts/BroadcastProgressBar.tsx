import { cn } from "@/lib/utils";

interface BroadcastProgressBarProps {
  sent: number;
  total: number;
  className?: string;
}

/** Thin sent/total progress bar with progressbar semantics. */
export function BroadcastProgressBar({
  sent,
  total,
  className,
}: BroadcastProgressBarProps) {
  const percent =
    total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={sent}
      aria-label={`${sent} of ${total} messages sent`}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-[#00a884] transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
