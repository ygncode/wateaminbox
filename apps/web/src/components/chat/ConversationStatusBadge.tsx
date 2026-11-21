import type { ConversationLifecycleStatus } from "@/types/chat";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ConversationLifecycleStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
};

const STATUS_CLASSES: Record<ConversationLifecycleStatus, string> = {
  open: "text-fg-muted ring-1 ring-inset ring-line-strong",
  pending: "bg-warning-soft text-warning",
  resolved: "text-fg-subtle ring-1 ring-inset ring-line",
};

export function ConversationStatusBadge({
  status,
  className,
}: {
  status: ConversationLifecycleStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[5px] px-1.5 py-[3px] text-[10.5px] font-medium leading-none",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
