import type { ColumnDef } from "@tanstack/react-table";
import type { BulkJob, BulkJobRecipient } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleCheck,
  CircleDashed,
  FileText,
  Film,
  Image as ImageIcon,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Send,
  TriangleAlert,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ServerDataTable } from "@/components/ui/server-data-table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBulkJob,
  useBulkJobRecipients,
  useCancelBulkJob,
} from "@/hooks/useBulkJobs";
import { useTableParams } from "@/hooks/useTableParams";
import { cn, formatPhoneNumber } from "@/lib/utils";
import { BroadcastProgressBar } from "./BroadcastProgressBar";
import { BroadcastStatusBadge } from "./BroadcastStatusBadge";
import { humanizeSkipReason, progressSummary } from "./broadcast-format";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

/** Values the API's recipient `status` filter accepts, plus the "all" reset. */
const RECIPIENT_STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "processing", label: "Sending" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "canceled", label: "Canceled" },
];
const RECIPIENT_STATUS_VALUES = RECIPIENT_STATUS_FILTERS.map(
  (option) => option.value,
);

const RECIPIENT_STATUS_CONFIG: Record<
  string,
  { className: string; dotClassName: string }
> = {
  sent: {
    className:
      "border-emerald-200 bg-emerald-50 text-[#087654] dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300",
    dotClassName: "bg-[#24a778]",
  },
  failed: {
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/35 dark:text-red-300",
    dotClassName: "bg-red-500",
  },
  skipped: {
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300",
    dotClassName: "bg-amber-500",
  },
  canceled: {
    className:
      "border-[#dfe5e1] bg-[#f1f3f2] text-[#65736d] dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary",
    dotClassName: "bg-[#8b9891]",
  },
  scheduled: {
    className:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-300",
    dotClassName: "bg-sky-500",
  },
  processing: {
    className:
      "border-emerald-200 bg-emerald-50 text-[#087654] dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300",
    dotClassName: "animate-pulse bg-[#24a778]",
  },
};

function RecipientStatus({ status }: { status: string }) {
  const config = RECIPIENT_STATUS_CONFIG[status] ?? {
    className:
      "border-[#dfe5e1] bg-[#f1f3f2] text-[#65736d] dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-secondary",
    dotClassName: "bg-[#8b9891]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize",
        config.className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", config.dotClassName)}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}

function mediaChip(
  job: BulkJob,
): { icon: typeof ImageIcon; label: string } | null {
  if (!job.mediaUrl) return null;
  const mimeType = job.mediaMimeType || "";
  if (mimeType.startsWith("image/")) return { icon: ImageIcon, label: "Photo" };
  if (mimeType.startsWith("video/")) return { icon: Film, label: "Video" };
  return { icon: FileText, label: "File" };
}

const OUTCOME_STYLES = {
  sent: {
    icon: CheckCircle2,
    className: "text-[#0b7a55] dark:text-emerald-300",
  },
  pending: { icon: CircleDashed, className: "text-sky-600 dark:text-sky-300" },
  failed: { icon: XCircle, className: "text-red-600 dark:text-red-300" },
  skipped: {
    icon: TriangleAlert,
    className: "text-amber-600 dark:text-amber-300",
  },
  canceled: {
    icon: Ban,
    className: "text-[#718078] dark:text-dark-text-secondary",
  },
};

function OutcomeMetric({
  type,
  label,
  value,
}: {
  type: keyof typeof OUTCOME_STYLES;
  label: string;
  value: number;
}) {
  const { icon: Icon, className } = OUTCOME_STYLES[type];
  return (
    // No dividers: the tile grid rewraps across breakpoints, so any "except the
    // first child" rule leaves a divider stranded at the start of a wrapped row.
    <div className="min-w-0">
      <div className={cn("flex items-center gap-1.5", className)}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p className="text-base font-semibold tabular-nums text-[#20362e] dark:text-dark-text-primary">
          {value}
        </p>
      </div>
      <p className="mt-0.5 truncate text-[10px] font-medium text-[#718078] dark:text-dark-text-secondary">
        {label}
      </p>
    </div>
  );
}

/** One label/value pair in the campaign metadata list. */
function MetaItem({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarClock;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8a9790] dark:text-dark-text-tertiary"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a9790] dark:text-dark-text-tertiary">
          {label}
        </dt>
        <dd className="mt-0.5 truncate text-[12px] font-medium text-[#31463e] dark:text-dark-text-primary">
          {children}
        </dd>
      </div>
    </div>
  );
}

function contactIdentity(recipient: BulkJobRecipient) {
  const phone = recipient.contactPhone
    ? formatPhoneNumber(recipient.contactPhone)
    : null;
  return {
    name: recipient.contactName || phone || "Unknown contact",
    phone: recipient.contactName ? phone : null,
    initials: recipient.contactName
      ? recipient.contactName
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase()
      : "#",
  };
}

function recipientDetail(recipient: BulkJobRecipient): string {
  return recipient.skipReason
    ? humanizeSkipReason(recipient.skipReason)
    : recipient.lastError || "No issues reported";
}

/** Absolute timestamp cell shared by the recipient date columns. */
function TimeCell({ value }: { value: string | null }) {
  if (!value) {
    return (
      <span className="text-[#adb8b2] dark:text-dark-text-tertiary">—</span>
    );
  }
  const at = dayjs(value);
  return (
    <time dateTime={value} className="block">
      <span className="block text-[12px] font-medium text-[#40554c] dark:text-dark-text-primary">
        {at.format("MMM D, YYYY")}
      </span>
      <span className="block text-[10px] text-[#7a8881] dark:text-dark-text-secondary">
        {at.format("HH:mm")}
      </span>
    </time>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto sm:gap-4">
      <div className="shrink-0 overflow-hidden rounded-2xl border border-[#d7e0da] bg-white dark:border-dark-border dark:bg-dark-elevated">
        <div className="flex items-center gap-3 border-b border-[#e3e9e5] px-4 py-3 dark:border-dark-border">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-4 w-52 rounded" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-3">
          <div className="space-y-3">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-8 w-full rounded" />
            ))}
          </div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-9 w-40 rounded" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-12 w-full rounded" />
          </div>
        </div>
      </div>
      <Skeleton className="min-h-[26rem] flex-1 rounded-2xl" />
    </div>
  );
}

interface BroadcastJobDetailProps {
  jobId: string;
}

/** Full detail view of one broadcast job with recipients and cancelation. */
export function BroadcastJobDetail({ jobId }: BroadcastJobDetailProps) {
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const { pagination, setPagination, getParam, setFilterParam, resetParams } =
    useTableParams({
      pageKey: "rPage",
      pageSizeKey: "rSize",
      defaultPageSize: DEFAULT_PAGE_SIZE,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
    });
  const statusFilter = getParam("status", RECIPIENT_STATUS_VALUES, "all");

  // A different campaign means a different recipient set: the page and filter
  // carried in the URL no longer describe anything meaningful.
  const lastJobId = useRef(jobId);
  useEffect(() => {
    if (lastJobId.current === jobId) return;
    lastJobId.current = jobId;
    resetParams(["status"]);
  }, [jobId, resetParams]);

  const {
    data: job,
    isLoading,
    isError,
    refetch: refetchJob,
  } = useBulkJob(jobId);
  const {
    data: recipientsPage,
    isLoading: recipientsLoading,
    isFetching: recipientsFetching,
    error: recipientsError,
    refetch: refetchRecipients,
  } = useBulkJobRecipients(jobId, {
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const cancelMutation = useCancelBulkJob();

  const recipientColumns: ColumnDef<BulkJobRecipient>[] = [
    {
      id: "contact",
      header: "Contact",
      size: 260,
      cell: ({ row }) => {
        const identity = contactIdentity(row.original);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="bg-[#e4f1ea] text-[10px] font-bold text-[#075c41] dark:bg-emerald-950/50 dark:text-emerald-300">
                {identity.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[#20362e] dark:text-dark-text-primary">
                {identity.name}
              </p>
              {identity.phone && (
                <p className="truncate text-[11px] text-[#718078] dark:text-dark-text-secondary">
                  {identity.phone}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 130,
      cell: ({ row }) => <RecipientStatus status={row.original.status} />,
    },
    {
      id: "detail",
      header: "Detail",
      size: 300,
      cell: ({ row }) => {
        const detail = recipientDetail(row.original);
        const hasIssue = Boolean(
          row.original.skipReason || row.original.lastError,
        );
        return (
          <p
            className={cn(
              "truncate text-xs",
              hasIssue
                ? "text-[#56675f] dark:text-dark-text-secondary"
                : "text-[#95a098] dark:text-dark-text-tertiary",
            )}
            title={detail}
          >
            {detail}
          </p>
        );
      },
    },
    {
      accessorKey: "scheduledAt",
      header: "Scheduled",
      size: 140,
      cell: ({ row }) => <TimeCell value={row.original.scheduledAt} />,
    },
    {
      accessorKey: "sentAt",
      // The table right-aligns the trailing cell; match it in the header.
      header: () => <span className="block text-right">Sent at</span>,
      size: 140,
      cell: ({ row }) => <TimeCell value={row.original.sentAt} />,
    },
  ];

  if (isLoading) return <DetailSkeleton />;

  if (isError || !job) {
    return (
      <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-2xl border border-[#d7e0da] bg-white px-6 py-12 text-center shadow-sm dark:border-dark-border dark:bg-dark-elevated">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/35 dark:text-red-300">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-3 text-sm font-semibold text-[#20362e] dark:text-dark-text-primary">
          Broadcast could not be loaded
        </h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-[#718078] dark:text-dark-text-secondary">
          It may have been removed, or the workspace connection was interrupted.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-2"
          onClick={() => void refetchJob()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  const media = mediaChip(job);
  const canCancel = job.status === "scheduled" || job.status === "running";
  const pending = job.progress.pending + job.progress.processing;
  const isScheduled = job.status === "scheduled";
  const totalRecipientRows = recipientsPage?.pagination.total ?? 0;

  const handleCancel = () => {
    cancelMutation.mutate(jobId, {
      onSuccess: () => {
        setConfirmCancelOpen(false);
        toast.success("Broadcast canceled");
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? `Failed to cancel broadcast: ${error.message}`
            : "Failed to cancel broadcast",
        );
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain sm:gap-4">
      <section
        aria-labelledby="broadcast-campaign-title"
        className="shrink-0 overflow-hidden rounded-2xl border border-[#d7e0da] bg-white shadow-[0_8px_24px_rgba(16,44,36,0.05)] dark:border-dark-border dark:bg-dark-elevated dark:shadow-none"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3e9e5] bg-[#fbfcfb] px-4 py-3 dark:border-dark-border dark:bg-dark-secondary/45 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2
              id="broadcast-campaign-title"
              className="truncate text-base font-semibold tracking-[-0.01em] text-[#172a23] dark:text-dark-text-primary"
            >
              {job.name}
            </h2>
            <BroadcastStatusBadge status={job.status} />
          </div>
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-2 border-red-200 text-red-600 shadow-none hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
              onClick={() => setConfirmCancelOpen(true)}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel broadcast
            </Button>
          )}
        </header>

        <div className="grid lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,1.25fr)_minmax(16rem,0.9fr)]">
          <dl className="grid gap-3.5 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-1">
            <MetaItem
              icon={isScheduled ? CalendarClock : Send}
              label={isScheduled ? "Sends" : "Started"}
            >
              <time dateTime={job.scheduledAt}>
                {dayjs(job.scheduledAt).format("MMM D, YYYY · HH:mm")}
              </time>
            </MetaItem>
            <MetaItem icon={UsersRound} label="Recipients">
              <span className="tabular-nums">{job.progress.total}</span>
            </MetaItem>
            <MetaItem icon={UserRound} label="Created by">
              {job.createdByName || "Unknown"}
            </MetaItem>
            <MetaItem icon={CalendarClock} label="Created">
              <time dateTime={job.createdAt}>
                {dayjs(job.createdAt).format("MMM D, YYYY · HH:mm")}
              </time>
            </MetaItem>
            {job.canceledAt ? (
              <MetaItem icon={Ban} label="Canceled">
                <time dateTime={job.canceledAt}>
                  {dayjs(job.canceledAt).format("MMM D, YYYY · HH:mm")}
                </time>
              </MetaItem>
            ) : (
              job.completedAt && (
                <MetaItem icon={CircleCheck} label="Completed">
                  <time dateTime={job.completedAt}>
                    {dayjs(job.completedAt).format("MMM D, YYYY · HH:mm")}
                  </time>
                </MetaItem>
              )
            )}
            {media && (
              <MetaItem icon={Paperclip} label="Attachment">
                {job.mediaFileName || media.label}
              </MetaItem>
            )}
          </dl>

          <article
            className="min-w-0 border-t border-[#e3e9e5] p-4 dark:border-dark-border sm:p-5 lg:border-l lg:border-t-0"
            aria-labelledby="message-preview-title"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e5f2eb] text-[#0b7a55] dark:bg-emerald-950/50 dark:text-emerald-300">
                  <MessageSquareText
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </span>
                <h3
                  id="message-preview-title"
                  className="text-xs font-semibold text-[#31463e] dark:text-dark-text-primary"
                >
                  Message preview
                </h3>
              </div>
              <span className="hidden text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a9790] dark:text-dark-text-tertiary sm:inline">
                Tokens personalize per contact
              </span>
            </div>

            <div className="mt-3 rounded-xl border border-[#e1e8e3] bg-[#f4f7f5] p-3 dark:border-dark-border dark:bg-dark-secondary/55 sm:p-4">
              <div className="max-h-52 overflow-y-auto rounded-xl rounded-tl-sm bg-[#dff4e8] px-3.5 py-3 text-[13px] leading-5 text-[#172a23] shadow-[0_1px_1px_rgba(16,44,36,0.06)] dark:bg-emerald-950/55 dark:text-dark-text-primary">
                {media && (
                  <span className="mb-2 flex w-fit max-w-full items-center gap-1.5 rounded-md bg-white/65 px-2 py-1 text-[10px] font-semibold text-[#52675f] dark:bg-white/10 dark:text-dark-text-secondary">
                    <media.icon
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {job.mediaFileName || media.label}
                    </span>
                  </span>
                )}
                {job.content ? (
                  <p className="whitespace-pre-wrap break-words">
                    {job.content}
                  </p>
                ) : (
                  <p className="italic text-[#718078] dark:text-dark-text-secondary">
                    Attachment-only message
                  </p>
                )}
              </div>
            </div>
          </article>

          <aside
            className="border-t border-[#e3e9e5] bg-[#fbfcfb] p-4 dark:border-dark-border dark:bg-dark-secondary/35 sm:p-5 lg:border-l lg:border-t-0"
            aria-labelledby="delivery-summary-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  id="delivery-summary-title"
                  className="text-xs font-semibold text-[#31463e] dark:text-dark-text-primary"
                >
                  Delivery summary
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.03em] text-[#172a23] dark:text-dark-text-primary">
                  {job.progress.sent}
                  <span className="ml-1 text-sm font-medium tracking-normal text-[#718078] dark:text-dark-text-secondary">
                    of {job.progress.total} sent
                  </span>
                </p>
              </div>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#d8e5dd] bg-white text-[#0b7a55] dark:border-dark-border dark:bg-dark-elevated dark:text-emerald-300">
                <Send className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>

            <BroadcastProgressBar
              sent={job.progress.sent}
              failed={job.progress.failed}
              skipped={job.progress.skipped}
              canceled={job.progress.canceled}
              total={job.progress.total}
              size="md"
              className="mt-3"
            />
            <p
              className="mt-1.5 text-[11px] text-[#718078] dark:text-dark-text-secondary"
              aria-live="polite"
            >
              {progressSummary(job)}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-[#e3e9e5] pt-3 dark:border-dark-border sm:grid-cols-5 lg:grid-cols-3">
              <OutcomeMetric
                type="sent"
                label="Sent"
                value={job.progress.sent}
              />
              <OutcomeMetric type="pending" label="Pending" value={pending} />
              <OutcomeMetric
                type="failed"
                label="Failed"
                value={job.progress.failed}
              />
              <OutcomeMetric
                type="skipped"
                label="Skipped"
                value={job.progress.skipped}
              />
              <OutcomeMetric
                type="canceled"
                label="Canceled"
                value={job.progress.canceled}
              />
            </div>
          </aside>
        </div>
      </section>

      <div className="min-h-[26rem] flex-1">
        <ServerDataTable
          columns={recipientColumns}
          data={recipientsPage?.data ?? []}
          rowCount={totalRecipientRows}
          pagination={pagination}
          onPaginationChange={setPagination}
          isLoading={recipientsLoading}
          isFetching={recipientsFetching}
          error={recipientsError}
          onRetry={() => void refetchRecipients()}
          getRowId={(recipient) => recipient.id}
          tableLabel="Broadcast recipients"
          toolbarLeading={
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#d7e0da] bg-white text-[#0b7a55] dark:border-dark-border dark:bg-dark-elevated dark:text-emerald-300">
                <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#31463e] dark:text-dark-text-primary">
                  Recipient outcomes
                </p>
                <p className="hidden truncate text-[10px] text-[#7a8881] sm:block dark:text-dark-text-secondary">
                  Individual delivery results and failure details.
                </p>
              </div>
            </div>
          }
          toolbarActions={
            <Select
              value={statusFilter}
              onValueChange={(value) => setFilterParam("status", value)}
            >
              <SelectTrigger
                className="h-8 w-40 border-[#d7e0da] bg-white text-xs shadow-none dark:border-dark-border dark:bg-dark-elevated"
                aria-label="Filter recipients by status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENT_STATUS_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          emptyTitle={
            statusFilter === "all" ? "No recipients" : "No matching recipients"
          }
          emptyDescription={
            statusFilter === "all"
              ? "Recipient outcomes appear here once the broadcast is prepared."
              : "Choose another status to see more delivery outcomes."
          }
          emptyAction={
            statusFilter === "all" ? undefined : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilterParam("status", "all")}
              >
                Clear filter
              </Button>
            )
          }
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          density="compact"
          tableClassName="min-w-[60rem]"
          className="min-h-0"
        />
      </div>

      <ConfirmationDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
        title="Cancel broadcast"
        description="Recipients who have not been messaged yet will not receive this broadcast. Messages that were already sent cannot be recalled."
        confirmText="Cancel broadcast"
        cancelText="Keep sending"
        isDestructive
        isLoading={cancelMutation.isPending}
        onConfirm={handleCancel}
      />
    </div>
  );
}
