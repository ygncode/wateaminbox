import { Archive, Download } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export type DateRange = "7d" | "30d" | "90d";
export type ExportType = "contacts" | "messages" | "full-backup";

export interface DashboardHeaderProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onExport: (type: ExportType) => void;
}

/**
 * Dashboard header with title, export buttons, and date range selector
 */
export function DashboardHeader({
  dateRange,
  onDateRangeChange,
  onExport,
}: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-dark-text-primary">
        Dashboard
      </h1>
      <div className="flex gap-2">
        {/* Export Buttons */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport("full-backup")}
          className="gap-1"
        >
          <Archive className="h-4 w-4" />
          Full Backup
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport("contacts")}
          className="gap-1"
        >
          <Download className="h-4 w-4" />
          Export Contacts
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport("messages")}
          className="gap-1"
        >
          <Download className="h-4 w-4" />
          Export Messages
        </Button>
        <div className="w-px bg-gray-200 dark:bg-dark-border mx-1" />
        {(["7d", "30d", "90d"] as const).map((range) => (
          <Button
            key={range}
            variant={dateRange === range ? "default" : "outline"}
            size="sm"
            onClick={() => onDateRangeChange(range)}
            className={cn(
              dateRange === range &&
                "bg-whatsapp-teal-green hover:bg-whatsapp-dark-green",
            )}
          >
            {range === "7d"
              ? "7 Days"
              : range === "30d"
                ? "30 Days"
                : "90 Days"}
          </Button>
        ))}
      </div>
    </div>
  );
}
