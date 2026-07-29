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
        <span className="font-medium text-[#596b64] dark:text-dark-text-secondary">
          {label}
        </span>
        <span className="font-semibold tabular-nums text-[#203b32] dark:text-dark-text-primary">
          {value}
          <span className="ml-1 text-[10px] font-normal text-[#95a099]">
            {Math.round(percentage)}%
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1ee] dark:bg-dark-tertiary">
        <div
          className="h-full rounded-full bg-[#0b7a55] transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default StatRow;
