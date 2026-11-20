import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ScheduledMessage } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";
import i18n from "@/lib/i18n";
import {
  AlertCircle,
  CalendarClock,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  useCancelScheduledMessage,
  useScheduledMessages,
} from "../../hooks/messages";
import { useTranslation } from "react-i18next";

interface ScheduledMessagesBarProps {
  contactId: string;
}

function formatScheduledTime(iso: string): string {
  // dayjs renders ISO UTC input in the viewer's local timezone by default.
  const value = dayjs(iso);
  if (value.isSame(dayjs(), "day"))
    return i18n.t("chat.todayAt", { time: value.format("HH:mm") });
  if (value.isSame(dayjs().add(1, "day"), "day")) {
    return i18n.t("chat.tomorrowAt", { time: value.format("HH:mm") });
  }
  return i18n.t("chat.dateAt", {
    date: value.format("MMM D, YYYY"),
    time: value.format("HH:mm"),
  });
}

function mediaKind(
  scheduledMessage: ScheduledMessage,
): { icon: typeof ImageIcon; labelKey: string; label: string } | null {
  if (!scheduledMessage.mediaUrl) return null;
  const mimeType = scheduledMessage.mediaMimeType || "";
  if (mimeType.startsWith("image/"))
    return {
      icon: ImageIcon,
      labelKey: "chat.mediaTypes.image",
      label: "Photo",
    };
  if (mimeType.startsWith("video/"))
    return { icon: Film, labelKey: "chat.mediaTypes.video", label: "Video" };
  return { icon: FileText, labelKey: "broadcasts.file", label: "File" };
}

function ScheduledMessageRow({
  scheduledMessage,
}: {
  scheduledMessage: ScheduledMessage;
}) {
  const { t } = useTranslation();

  const cancelMutation = useCancelScheduledMessage();
  const isFailed = scheduledMessage.status === "failed";
  const media = mediaKind(scheduledMessage);

  const handleCancel = () => {
    cancelMutation.mutate(scheduledMessage.id, {
      onSuccess: () => {
        toast.success(
          isFailed
            ? t("chat.failedMessageDismissed", "Failed message dismissed")
            : t("chat.scheduledMessageCanceled", "Scheduled message canceled"),
        );
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? t("chat.cancelFailedWithReason", { message: error.message })
            : t(
                "chat.cancelScheduledFailed",
                "Failed to cancel scheduled message",
              ),
        );
      },
    });
  };

  return (
    <li className="flex items-start gap-3 rounded-xl border border-line/[0.06] bg-surface p-3">
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full ${
          isFailed ? "bg-danger-soft text-danger" : "bg-accent/10 text-accent"
        }`}
      >
        {isFailed ? (
          <AlertCircle className="size-4" aria-hidden="true" />
        ) : (
          <CalendarClock className="size-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm text-fg">
          {scheduledMessage.bulkJobId && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              <Megaphone className="size-3" aria-hidden="true" />
              Broadcast
            </span>
          )}
          {media && (
            <span className="inline-flex shrink-0 items-center gap-1 text-fg-muted">
              <media.icon className="size-3.5" aria-hidden="true" />
              <span className="text-xs font-medium">
                {t(media.labelKey, media.label)}
              </span>
            </span>
          )}
          <span className="truncate">
            {scheduledMessage.content ||
              scheduledMessage.mediaFileName ||
              (media ? t(media.labelKey, media.label) : null)}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {isFailed
            ? t("chat.scheduledFailedReason", {
                defaultValue: "Failed: {{reason}}",
                reason:
                  scheduledMessage.lastError ||
                  t("chat.couldNotBeSent", "could not be sent"),
              })
            : t("chat.sendsAt", {
                defaultValue: "Sends {{time}}",
                time: formatScheduledTime(scheduledMessage.scheduledAt),
              })}
          {scheduledMessage.createdByName &&
            ` · ${t("chat.byUser", {
              defaultValue: "by {{name}}",
              name: scheduledMessage.createdByName,
            })}`}
        </p>
      </div>
      <button
        type="button"
        onClick={handleCancel}
        disabled={cancelMutation.isPending}
        className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-fg/[0.055] hover:text-danger disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={
          isFailed
            ? t("chat.dismissFailedMessage", "Dismiss failed message")
            : t("chat.cancelScheduledMessage", "Cancel scheduled message")
        }
      >
        {cancelMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-4" aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

/**
 * Strip above the composer input showing this conversation's upcoming (and
 * failed) scheduled messages, with a dialog to review and cancel them.
 */
export function ScheduledMessagesBar({ contactId }: ScheduledMessagesBarProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { data: scheduledMessages } = useScheduledMessages(contactId);

  if (!scheduledMessages || scheduledMessages.length === 0) {
    return null;
  }

  const failedCount = scheduledMessages.filter(
    (item) => item.status === "failed",
  ).length;
  const upcomingCount = scheduledMessages.length - failedCount;

  const summary = [
    upcomingCount > 0 && t("chat.scheduledCount", { count: upcomingCount }),
    failedCount > 0 && t("chat.failedCount", { count: failedCount }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="flex min-h-8 items-center gap-1.5 border-b border-line/[0.055] bg-surface/55 px-4 py-1">
        <CalendarClock
          className={`size-3.5 shrink-0 ${
            failedCount > 0 ? "text-danger" : "text-accent"
          }`}
          aria-hidden="true"
        />
        <span className="truncate text-[11px] text-fg-muted">{summary}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ms-auto shrink-0 text-[11px] font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          View
        </button>
      </div>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 animate-in fade-in-0" />
          <DialogPrimitive.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-4 shadow-xl animate-in fade-in-0 zoom-in-95">
            <div className="flex items-center justify-between">
              <DialogPrimitive.Title className="text-base font-semibold text-fg">
                {t("chat.scheduledMessages", "Scheduled messages")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-full text-fg-muted transition-colors hover:bg-fg/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-label={t("common.close", "Close")}
                >
                  <X className="size-4.5" aria-hidden="true" />
                </button>
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Description className="mt-1 text-xs text-fg-muted">
              {t(
                "chat.scheduledMessagesHint",
                "These messages will be sent automatically at their scheduled time.",
              )}
            </DialogPrimitive.Description>
            <ul className="mt-3 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {scheduledMessages.map((scheduledMessage) => (
                <ScheduledMessageRow
                  key={scheduledMessage.id}
                  scheduledMessage={scheduledMessage}
                />
              ))}
            </ul>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
