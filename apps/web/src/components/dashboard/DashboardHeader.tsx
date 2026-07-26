import { Archive, ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateRange = "7d" | "30d" | "90d";
export type ExportType = "contacts" | "messages" | "full-backup";

export interface DashboardHeaderProps {
  workspaceName: string;
  dateRange: DateRange;
  canExport: boolean;
  onDateRangeChange: (range: DateRange) => void;
  onExport: (type: ExportType) => void;
}

const ranges: Array<{ id: DateRange; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

/** One responsive dashboard header with consolidated export actions. */
export function DashboardHeader({
  workspaceName,
  dateRange,
  canExport,
  onDateRangeChange,
  onExport,
}: DashboardHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold text-[#0b7a55]">{workspaceName}</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 text-balance dark:text-dark-text-primary">
          Dashboard
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="hidden rounded-lg border border-gray-200 bg-white p-1 dark:border-dark-border dark:bg-dark-elevated sm:flex">
          {ranges.map((range) => (
            <button
              key={range.id}
              type="button"
              onClick={() => onDateRangeChange(range.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                dateRange === range.id
                  ? "bg-[#dcefe7] text-[#075c41]"
                  : "text-gray-500 hover:text-gray-900 dark:text-dark-text-secondary dark:hover:text-white",
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
        <select
          value={dateRange}
          onChange={(event) =>
            onDateRangeChange(event.target.value as DateRange)
          }
          className="h-9 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-dark-border dark:bg-dark-elevated sm:hidden"
          aria-label="Dashboard date range"
        >
          {ranges.map((range) => (
            <option key={range.id} value={range.id}>
              Last {range.label}
            </option>
          ))}
        </select>
        {canExport && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" /> Export
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1.5">
              <ExportAction
                label="Contacts"
                onClick={() => onExport("contacts")}
              />
              <ExportAction
                label="Messages"
                onClick={() => onExport("messages")}
              />
              <ExportAction
                label="Full backup"
                icon={Archive}
                onClick={() => onExport("full-backup")}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function ExportAction({
  label,
  onClick,
  icon: Icon = Download,
}: {
  label: string;
  onClick: () => void;
  icon?: typeof Download;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-[#edf1ed] dark:hover:bg-dark-tertiary"
    >
      <Icon className="h-4 w-4 text-[#65736d]" /> {label}
    </button>
  );
}
