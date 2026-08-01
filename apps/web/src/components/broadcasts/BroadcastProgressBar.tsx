import { cn } from "@/lib/utils";

interface BroadcastProgressBarProps {
  sent: number;
  total: number;
  failed?: number;
  skipped?: number;
  canceled?: number;
  className?: string;
  size?: "sm" | "md";
}

/** Compact segmented outcome bar; unfilled track represents recipients waiting. */
export function BroadcastProgressBar({
  sent,
  total,
  failed = 0,
  skipped = 0,
  canceled = 0,
  className,
  size = "sm",
}: BroadcastProgressBarProps) {
  const percent = (value: number) =>
    total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  const completed = sent + failed + skipped + canceled;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-label={`${sent} sent, ${failed} failed, ${skipped} skipped, ${canceled} canceled out of ${total} recipients`}
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-[#e7ece8] dark:bg-dark-tertiary",
        size === "md" ? "h-2" : "h-1.5",
        className,
      )}
    >
      {sent > 0 && (
        <span
          className="h-full bg-[#24a778] transition-[width] duration-500 dark:bg-emerald-500"
          style={{ width: `${percent(sent)}%` }}
        />
      )}
      {failed > 0 && (
        <span
          className="h-full bg-red-500 transition-[width] duration-500 dark:bg-red-400"
          style={{ width: `${percent(failed)}%` }}
        />
      )}
      {skipped > 0 && (
        <span
          className="h-full bg-amber-400 transition-[width] duration-500 dark:bg-amber-500"
          style={{ width: `${percent(skipped)}%` }}
        />
      )}
      {canceled > 0 && (
        <span
          className="h-full bg-[#9aa69f] transition-[width] duration-500 dark:bg-dark-text-tertiary"
          style={{ width: `${percent(canceled)}%` }}
        />
      )}
    </div>
  );
}
