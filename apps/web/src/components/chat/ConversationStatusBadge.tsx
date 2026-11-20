import type { ConversationLifecycleStatus } from "@/types/chat";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ConversationLifecycleStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
};

const STATUS_CLASSES: Record<ConversationLifecycleStatus, string> = {
  open: "bg-accent/10 text-accent",
  pending: "bg-warning-soft text-warning",
  resolved: "bg-muted text-fg-muted",
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
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
