import type { BulkJob } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";

/** Render an ISO timestamp the way ScheduledMessagesBar does. */
export function formatScheduledTime(iso: string): string {
  // dayjs renders ISO UTC input in the viewer's local timezone by default.
  const value = dayjs(iso);
  if (value.isSame(dayjs(), "day")) return `today at ${value.format("HH:mm")}`;
  if (value.isSame(dayjs().add(1, "day"), "day")) {
    return `tomorrow at ${value.format("HH:mm")}`;
  }
  return value.format("MMM D, YYYY [at] HH:mm");
}

const SKIP_REASON_LABELS: Record<string, string> = {
  no_jid: "No WhatsApp ID",
  blocked: "Blocked contact",
  duplicate_jid: "Duplicate number",
  no_connection: "No linked account",
  connection_filtered: "Different account",
  connection_archived: "Archived account",
  connection_changed: "Account changed",
  is_group: "Group chat",
  contact_missing: "Contact removed",
};

/** Human label for a recipient skip reason code. */
export function humanizeSkipReason(reason: string): string {
  return SKIP_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

/** Humanize a duration in seconds, e.g. "~25 minutes". */
export function humanizeDuration(seconds: number): string {
  if (seconds < 60) {
    const value = Math.max(1, Math.round(seconds));
    return `~${value} second${value === 1 ? "" : "s"}`;
  }
  if (seconds < 3600) {
    const value = Math.max(1, Math.round(seconds / 60));
    return `~${value} minute${value === 1 ? "" : "s"}`;
  }
  if (seconds < 86400) {
    const value = Math.max(1, Math.round(seconds / 3600));
    return `~${value} hour${value === 1 ? "" : "s"}`;
  }
  const value = Math.max(1, Math.round(seconds / 86400));
  return `~${value} day${value === 1 ? "" : "s"}`;
}

/** One-line recipient outcome summary, e.g. "42 of 100 sent · 2 failed". */
export function progressSummary(job: BulkJob): string {
  const { total, sent, failed, skipped, canceled } = job.progress;
  const parts: string[] = [];
  if (job.status === "scheduled" && sent === 0) {
    parts.push(`${total} recipient${total === 1 ? "" : "s"}`);
  } else {
    parts.push(`${sent} of ${total} sent`);
  }
  if (failed > 0) parts.push(`${failed} failed`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (canceled > 0) parts.push(`${canceled} canceled`);
  return parts.join(" · ");
}

/** Substitute personalization tokens with a sample contact name. */
export function personalizeSample(content: string, fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return content
    .replace(/\{\{\s*name\s*\}\}/g, fullName)
    .replace(/\{\{\s*firstName\s*\}\}/g, firstName);
}
