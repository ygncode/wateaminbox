export interface StatRowProps {
  label: string;
  value: number;
  total: number;
}

/**
 * Stat row for bar-style display with progress
 */
export function StatRow({ label, value, total }: StatRowProps) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-fg-muted">{label}</span>
        <span className="font-semibold tabular-nums text-fg">
          {value}
          <span className="ms-1 text-[10px] font-normal text-fg-muted">
            {Math.round(percentage)}%
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
