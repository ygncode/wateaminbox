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
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600 dark:text-dark-text-secondary">
          {label}
        </span>
        <span className="font-medium text-gray-900 dark:text-dark-text-primary">
          {value}
        </span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-dark-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-whatsapp-teal-green rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default StatRow;
