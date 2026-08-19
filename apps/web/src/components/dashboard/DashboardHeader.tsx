import { Archive, BarChart3, ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type DateRange = "7d" | "30d" | "90d";
export type ExportType = "contacts" | "messages" | "full-backup";

export interface DashboardHeaderProps {
  workspaceName: string;
  dateRange: DateRange;
  canExport: boolean;
  onDateRangeChange: (range: DateRange) => void;
  onExport: (type: ExportType) => void;
}

const ranges: Array<{ id: DateRange; labelKey: string; label: string }> = [
  { id: "7d", labelKey: "dashboard.ranges.7d", label: "7 days" },
  { id: "30d", labelKey: "dashboard.ranges.30d", label: "30 days" },
  { id: "90d", labelKey: "dashboard.ranges.90d", label: "90 days" },
];

/** One responsive dashboard header with consolidated export actions. */
export function DashboardHeader({
  workspaceName,
  dateRange,
  canExport,
  onDateRangeChange,
  onExport,
}: DashboardHeaderProps) {
  const { t } = useTranslation();

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const selectExport = (type: ExportType) => {
    setExportMenuOpen(false);
    onExport(type);
  };

  return (
    <header className="shrink-0 border-b border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/60 dark:text-emerald-300">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-none text-gray-900 dark:text-dark-text-primary">
              Dashboard
            </h1>
            <p className="mt-1 truncate text-xs text-[#65736d] dark:text-dark-text-secondary">
              {workspaceName} · workspace analytics and service health
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <div
            className="hidden rounded-lg border border-[#d7e0da] bg-[#f7f9f7] p-0.5 dark:border-dark-border dark:bg-dark-elevated sm:flex"
            role="group"
            aria-label={t("dashboard.dateRangeAria", "Dashboard date range")}
          >
            {ranges.map((range) => (
              <button
                key={range.id}
                type="button"
                onClick={() => onDateRangeChange(range.id)}
                aria-pressed={dateRange === range.id}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow]",
                  dateRange === range.id
                    ? "bg-white text-[#075c41] shadow-sm dark:bg-dark-tertiary dark:text-emerald-300"
                    : "text-[#65736d] hover:text-[#10211b] dark:text-dark-text-secondary dark:hover:text-white",
                )}
              >
                {t(range.labelKey, range.label)}
              </button>
            ))}
          </div>
          <select
            value={dateRange}
            onChange={(event) =>
              onDateRangeChange(event.target.value as DateRange)
            }
            className="h-9 min-w-0 flex-1 rounded-lg border border-[#d7e0da] bg-white px-3 text-sm text-[#10211b] dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-primary sm:hidden"
            aria-label={t("dashboard.dateRangeAria", "Dashboard date range")}
          >
            {ranges.map((range) => (
              <option key={range.id} value={range.id}>
                {t("dashboard.lastRange", {
                  defaultValue: "Last {{range}}",
                  range: t(range.labelKey, range.label),
                })}
              </option>
            ))}
          </select>
          {canExport && (
            <Popover open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-[#d7e0da] shadow-sm dark:border-dark-border"
                >
                  <Download className="h-4 w-4" /> Export
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1.5">
                <ExportAction
                  label={t("dashboard.exportContacts", "Contacts")}
                  onClick={() => selectExport("contacts")}
                />
                <ExportAction
                  label={t("dashboard.exportMessages", "Messages")}
                  onClick={() => selectExport("messages")}
                />
                <ExportAction
                  label={t("dashboard.exportFullBackup", "Full backup")}
                  icon={Archive}
                  onClick={() => selectExport("full-backup")}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </header>
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
