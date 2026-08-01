import type { BulkJob } from "@wateaminbox/shared";
import { AlertCircle, Megaphone, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBulkJobs } from "@/hooks/useBulkJobs";
import { formatScheduledTime, progressSummary } from "./broadcast-format";
import { BroadcastProgressBar } from "./BroadcastProgressBar";
import { BroadcastStatusBadge } from "./BroadcastStatusBadge";

const PAGE_SIZE = 25;

interface BroadcastJobListProps {
  onCreateBroadcast: () => void;
  onOpenJob: (jobId: string) => void;
}

function JobRow({ job, onOpen }: { job: BulkJob; onOpen: () => void }) {
  const timeLabel =
    job.status === "scheduled"
      ? `Sends ${formatScheduledTime(job.scheduledAt)}`
      : `Started ${formatScheduledTime(job.scheduledAt)}`;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-xl border border-black/[0.06] bg-white p-4 text-left transition-colors hover:bg-[#f5f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:border-white/[0.07] dark:bg-dark-secondary dark:hover:bg-dark-tertiary"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-[#111b21] dark:text-dark-text-primary">
            {job.name}
          </span>
          <BroadcastStatusBadge status={job.status} />
        </div>
        <p className="mt-1 text-sm text-[#667781] dark:text-dark-text-secondary">
          {progressSummary(job)}
        </p>
        <p className="mt-0.5 text-xs text-[#667781] dark:text-dark-text-tertiary">
          {timeLabel}
          {job.createdByName && ` · by ${job.createdByName}`}
        </p>
        {job.status === "running" && (
          <BroadcastProgressBar
            sent={job.progress.sent}
            total={job.progress.total}
            className="mt-3"
          />
        )}
      </button>
    </li>
  );
}

/** Paginated list of broadcast jobs with an empty state and create CTA. */
export function BroadcastJobList({
  onCreateBroadcast,
  onOpenJob,
}: BroadcastJobListProps) {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isError, refetch } = useBulkJobs({
    limit: PAGE_SIZE,
    offset,
  });

  const jobs = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#111b21] dark:text-dark-text-primary">
            Broadcasts
          </h1>
          <p className="mt-1 text-sm text-[#667781] dark:text-dark-text-secondary">
            Send a message to many contacts at once, paced to stay safe.
          </p>
        </div>
        <Button onClick={onCreateBroadcast} className="gap-2">
          <Plus aria-hidden="true" />
          New broadcast
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center rounded-xl border border-black/[0.06] px-6 py-12 text-center dark:border-white/[0.07]">
            <AlertCircle
              className="size-8 text-red-500 dark:text-red-400"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
              Failed to load broadcasts
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-black/[0.1] px-6 py-16 text-center dark:border-white/[0.12]">
            <span className="grid size-14 place-items-center rounded-full bg-[#00a884]/10 text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300">
              <Megaphone className="size-7" aria-hidden="true" />
            </span>
            <p className="mt-4 text-sm font-semibold text-[#111b21] dark:text-dark-text-primary">
              No broadcasts yet
            </p>
            <p className="mt-1 max-w-sm text-sm text-[#667781] dark:text-dark-text-secondary">
              Reach a group of contacts with one scheduled, personalized
              message.
            </p>
            <Button onClick={onCreateBroadcast} className="mt-5 gap-2">
              <Plus aria-hidden="true" />
              New broadcast
            </Button>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onOpen={() => onOpenJob(job.id)}
                />
              ))}
            </ul>
            {pagination && pagination.total > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-[#667781] dark:text-dark-text-tertiary">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, pagination.total)}{" "}
                  of {pagination.total}
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
          </>
        )}
      </div>
    </div>
  );
}
