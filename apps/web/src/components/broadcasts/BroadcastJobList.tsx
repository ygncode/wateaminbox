import type { ColumnDef } from "@tanstack/react-table";
import type { BulkJob } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";
import {
  CalendarClock,
  ChevronRight,
  History,
  Megaphone,
  Plus,
  Send,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ServerDataTable } from "@/components/ui/server-data-table";
import { useBulkJobs } from "@/hooks/useBulkJobs";
import { useTableParams } from "@/hooks/useTableParams";
import { BroadcastProgressBar } from "./BroadcastProgressBar";
import { BroadcastStatusBadge } from "./BroadcastStatusBadge";
import { progressSummary } from "./broadcast-format";
import { useTranslation } from "react-i18next";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

interface BroadcastJobListProps {
  onCreateBroadcast: () => void;
  /** Route for one job, so rows are real links (middle-click, open in tab). */
  getJobHref: (jobId: string) => string;
}

/** Full-height, server-paginated broadcast history. */
export function BroadcastJobList({
  onCreateBroadcast,
  getJobHref,
}: BroadcastJobListProps) {
  const { t } = useTranslation();

  const { pagination, setPagination } = useTableParams({
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  });

  const { data, isLoading, isFetching, error, refetch } = useBulkJobs({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
  });

  const total = data?.pagination.total ?? 0;

  const columns: ColumnDef<BulkJob>[] = [
    {
      id: "campaign",
      header: t("broadcasts.campaign", "Campaign"),
      size: 320,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[#d8e5dd] bg-[#edf6f1] text-[#0b7a55] dark:border-dark-border dark:bg-emerald-950/35 dark:text-emerald-300">
            <Megaphone className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link
              to={getJobHref(row.original.id)}
              className="block truncate rounded text-[13px] font-semibold text-[#20362e] hover:text-[#0b7a55] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7a55]/40 dark:text-dark-text-primary dark:hover:text-emerald-300"
            >
              {row.original.name}
            </Link>
            <p className="truncate text-[11px] text-[#718078] dark:text-dark-text-secondary">
              {row.original.createdByName
                ? `Created by ${row.original.createdByName}`
                : t("broadcasts.workspaceBroadcast", "Workspace broadcast")}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: t("broadcasts.statusHeader", "Status"),
      size: 130,
      cell: ({ row }) => <BroadcastStatusBadge status={row.original.status} />,
    },
    {
      id: "delivery",
      header: t("broadcasts.delivery", "Delivery"),
      size: 270,
      cell: ({ row }) => {
        const { progress } = row.original;
        const waiting = progress.pending + progress.processing;
        const summary = progressSummary(row.original);
        return (
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p
                className="truncate text-[11px] font-medium text-[#31463e] dark:text-dark-text-primary"
                title={summary}
              >
                {summary}
              </p>
              {waiting > 0 && (
                <span className="shrink-0 text-[10px] font-medium tabular-nums text-[#718078] dark:text-dark-text-secondary">
                  {waiting} waiting
                </span>
              )}
            </div>
            <BroadcastProgressBar
              sent={progress.sent}
              failed={progress.failed}
              skipped={progress.skipped}
              canceled={progress.canceled}
              total={progress.total}
              className="mt-1.5"
            />
          </div>
        );
      },
    },
    {
      accessorKey: "scheduledAt",
      header: t("broadcasts.schedule", "Schedule"),
      size: 190,
      cell: ({ row }) => {
        const isScheduled = row.original.status === "scheduled";
        const at = dayjs(row.original.scheduledAt);
        const Icon = isScheduled ? CalendarClock : Send;
        return (
          <div className="flex items-center gap-2 text-[#65736d] dark:text-dark-text-secondary">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <time dateTime={row.original.scheduledAt} className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-[#40554c] dark:text-dark-text-primary">
                {at.format("MMM D, YYYY")}
              </span>
              <span className="block truncate text-[10px]">
                {isScheduled ? "Sends" : "Started"} {at.format("HH:mm")}
              </span>
            </time>
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: t("broadcasts.created", "Created"),
      size: 140,
      cell: ({ row }) => (
        <time
          dateTime={row.original.createdAt}
          className="font-mono text-[11px] text-[#718078] dark:text-dark-text-secondary"
        >
          {dayjs(row.original.createdAt).format("MMM D, YYYY")}
        </time>
      ),
    },
    {
      id: "open",
      header: () => (
        <span className="sr-only">{t("broadcasts.open", "Open")}</span>
      ),
      size: 60,
      cell: ({ row }) => (
        // The campaign name is the accessible link; this is a pointer affordance
        // only, so it stays out of the tab order and the accessibility tree.
        <Link
          to={getJobHref(row.original.id)}
          tabIndex={-1}
          aria-hidden="true"
          className="inline-grid h-8 w-8 place-items-center rounded-full text-[#9aa69f] transition-colors hover:bg-[#e8f1ec] hover:text-[#075c41] dark:text-dark-text-tertiary dark:hover:bg-dark-tertiary dark:hover:text-emerald-300"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  return (
    <ServerDataTable
      columns={columns}
      data={data?.data ?? []}
      rowCount={total}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={() => void refetch()}
      getRowId={(job) => job.id}
      tableLabel={t("broadcasts.campaignsTableLabel", "Broadcast campaigns")}
      toolbarLeading={
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#d7e0da] bg-white text-[#0b7a55] dark:border-dark-border dark:bg-dark-elevated dark:text-emerald-300">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#31463e] dark:text-dark-text-primary">
              {t("broadcasts.campaignHistory", "Campaign history")}
            </p>
            <p className="hidden truncate text-[10px] text-[#7a8881] sm:block dark:text-dark-text-secondary">
              {t(
                "broadcasts.campaignHistoryHint",
                "Newest first — open a campaign for recipient outcomes.",
              )}
            </p>
          </div>
        </div>
      }
      emptyTitle={t("broadcasts.emptyTitle", "No broadcasts yet")}
      emptyDescription={t(
        "broadcasts.emptyDescription",
        "Build an audience, personalize one message, and schedule delivery at a safe pace.",
      )}
      emptyAction={
        <Button size="sm" className="gap-2" onClick={onCreateBroadcast}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("broadcasts.newBroadcast", "New broadcast")}
        </Button>
      }
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      density="compact"
      tableClassName="min-w-[68rem]"
      className="min-h-0"
    />
  );
}
