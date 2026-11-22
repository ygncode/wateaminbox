import { Archive, BarChart3, ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    <header
      data-sk="page-header"
      className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-none text-fg">
              Dashboard
            </h1>
            <p className="mt-1 truncate text-xs text-fg-muted">
              {workspaceName} · workspace analytics and service health
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <div
            className="hidden rounded-lg border border-line bg-surface p-0.5 sm:flex"
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
                    ? "bg-raised text-accent shadow-sm"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {t(range.labelKey, range.label)}
              </button>
            ))}
          </div>
          <Select
            value={dateRange}
            onValueChange={(value) => {
              onDateRangeChange(value as DateRange);
            }}
          >
            <SelectTrigger
              aria-label={t("dashboard.dateRangeAria", "Dashboard date range")}
              className="h-9 min-w-0 flex-1 sm:hidden"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ranges.map((range) => (
                <SelectItem key={range.id} value={range.id}>
                  {t("dashboard.lastRange", {
                    defaultValue: "Last {{range}}",
                    range: t(range.labelKey, range.label),
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canExport && (
            <Popover open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-line shadow-sm"
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
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
    >
      <Icon className="h-4 w-4 text-fg-muted" /> {label}
    </button>
  );
}
