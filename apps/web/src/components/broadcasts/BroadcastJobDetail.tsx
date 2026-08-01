import type { BulkJob, BulkJobRecipient } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  FileText,
  Film,
  Image as ImageIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBulkJob,
  useBulkJobRecipients,
  useCancelBulkJob,
} from "@/hooks/useBulkJobs";
import { cn, formatPhoneNumber } from "@/lib/utils";
import {
  formatScheduledTime,
  humanizeSkipReason,
  progressSummary,
} from "./broadcast-format";
import { BroadcastProgressBar } from "./BroadcastProgressBar";
import { BroadcastStatusBadge } from "./BroadcastStatusBadge";

const PAGE_SIZE = 25;

const RECIPIENT_STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "canceled", label: "Canceled" },
];

const RECIPIENT_STATUS_CLASSES: Record<string, string> = {
  sent: "bg-[#00a884]/10 text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  skipped:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  canceled:
    "bg-black/[0.05] text-[#667781] dark:bg-white/[0.07] dark:text-dark-text-secondary",
};

function recipientStatusClass(status: string): string {
  return (
    RECIPIENT_STATUS_CLASSES[status] ??
    "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white px-4 py-3 dark:border-white/[0.07] dark:bg-dark-secondary">
      <p className="text-xl font-semibold tabular-nums text-[#111b21] dark:text-dark-text-primary">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-[#667781] dark:text-dark-text-tertiary">
        {label}
      </p>
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: BulkJobRecipient }) {
  const name =
    recipient.contactName ||
    (recipient.contactPhone
      ? formatPhoneNumber(recipient.contactPhone)
      : "Unknown contact");
  const detail = recipient.skipReason
    ? humanizeSkipReason(recipient.skipReason)
    : recipient.lastError || "—";

  return (
    <tr className="border-b border-black/[0.04] last:border-b-0 dark:border-white/[0.05]">
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
          {name}
        </p>
        {recipient.contactName && recipient.contactPhone && (
          <p className="mt-0.5 text-xs text-[#667781] dark:text-dark-text-tertiary">
            {formatPhoneNumber(recipient.contactPhone)}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
            recipientStatusClass(recipient.status),
          )}
        >
          {recipient.status}
        </span>
      </td>
      <td className="max-w-64 truncate px-4 py-3 text-sm text-[#667781] dark:text-dark-text-secondary">
        {detail}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-[#667781] dark:text-dark-text-secondary">
        {recipient.sentAt
          ? dayjs(recipient.sentAt).format("MMM D, HH:mm")
          : "—"}
      </td>
    </tr>
  );
}

interface BroadcastJobDetailProps {
  jobId: string;
  onBack: () => void;
}

/** Full detail view of one broadcast job with recipients and cancelation. */
export function BroadcastJobDetail({ jobId, onBack }: BroadcastJobDetailProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const { data: job, isLoading, isError } = useBulkJob(jobId);
  const { data: recipientsPage, isLoading: recipientsLoading } =
    useBulkJobRecipients(jobId, {
      limit: PAGE_SIZE,
      offset,
      status: statusFilter === "all" ? undefined : statusFilter,
    });
  const cancelMutation = useCancelBulkJob();

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-[#008069] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-emerald-300"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Broadcasts
    </button>
  );

  if (isLoading) {
    return (
      <div>
        {backButton}
        <Skeleton className="mt-4 h-8 w-64 rounded-lg" />
        <Skeleton className="mt-4 h-28 w-full rounded-xl" />
        <Skeleton className="mt-4 h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div>
        {backButton}
        <div className="mt-8 flex flex-col items-center rounded-xl border border-black/[0.06] px-6 py-12 text-center dark:border-white/[0.07]">
          <AlertCircle
            className="size-8 text-red-500 dark:text-red-400"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
            Broadcast not found
          </p>
        </div>
      </div>
    );
  }

  const media = mediaChip(job);
  const canCancel = job.status === "scheduled" || job.status === "running";
  const pending = job.progress.pending + job.progress.processing;
  const pagination = recipientsPage?.pagination;
  const recipients = recipientsPage?.data ?? [];

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
    <div>
      {backButton}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1 className="min-w-0 truncate text-xl font-semibold text-[#111b21] dark:text-dark-text-primary">
            {job.name}
          </h1>
          <BroadcastStatusBadge status={job.status} />
        </div>
        {canCancel && (
          <Button
            variant="outline"
            className="gap-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => setConfirmCancelOpen(true)}
          >
            <Ban aria-hidden="true" />
            Cancel broadcast
          </Button>
        )}
      </div>

      <p className="mt-1 text-xs text-[#667781] dark:text-dark-text-tertiary">
        {job.status === "scheduled" ? "Sends" : "Started"}{" "}
        {formatScheduledTime(job.scheduledAt)}
        {job.createdByName && ` · by ${job.createdByName}`}
      </p>

      {/* Message preview */}
      <div className="mt-5 rounded-xl border border-black/[0.06] bg-[#f5f7f4] p-4 dark:border-white/[0.07] dark:bg-dark-secondary">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-dark-text-tertiary">
          Message
        </p>
        {media && (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-medium text-[#54656f] dark:bg-white/[0.07] dark:text-dark-text-secondary">
            <media.icon className="size-3.5" aria-hidden="true" />
            {job.mediaFileName || media.label}
          </span>
        )}
        {job.content && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-[#111b21] dark:text-dark-text-primary">
            {job.content}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Sent" value={job.progress.sent} />
        <StatTile label="Pending" value={pending} />
        <StatTile label="Failed" value={job.progress.failed} />
        <StatTile label="Skipped" value={job.progress.skipped} />
        <StatTile label="Canceled" value={job.progress.canceled} />
      </div>

      <div className="mt-4">
        <BroadcastProgressBar
          sent={job.progress.sent}
          total={job.progress.total}
        />
        <p
          className="mt-1.5 text-xs text-[#667781] dark:text-dark-text-tertiary"
          aria-live="polite"
        >
          {progressSummary(job)}
        </p>
      </div>

      {/* Recipients */}
      <div className="mt-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[#111b21] dark:text-dark-text-primary">
            Recipients
          </h2>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setOffset(0);
            }}
          >
            <SelectTrigger
              className="h-9 w-44"
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
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-black/[0.06] bg-[#f5f7f4] dark:border-white/[0.07] dark:bg-dark-secondary">
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-dark-text-tertiary">
                  Contact
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-dark-text-tertiary">
                  Status
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-dark-text-tertiary">
                  Detail
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-dark-text-tertiary">
                  Sent at
                </th>
              </tr>
            </thead>
            <tbody>
              {recipientsLoading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-[#667781] dark:text-dark-text-secondary"
                  >
                    Loading recipients…
                  </td>
                </tr>
              ) : recipients.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-[#667781] dark:text-dark-text-secondary"
                  >
                    No recipients{statusFilter !== "all" && " with this status"}
                  </td>
                </tr>
              ) : (
                recipients.map((recipient) => (
                  <RecipientRow key={recipient.id} recipient={recipient} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-[#667781] dark:text-dark-text-tertiary">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, pagination.total)} of{" "}
              {pagination.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasMore}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
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
