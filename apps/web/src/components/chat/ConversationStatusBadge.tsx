import type { ConversationLifecycleStatus } from "@/types/chat";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ConversationLifecycleStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
};

const STATUS_CLASSES: Record<ConversationLifecycleStatus, string> = {
  open: "bg-whatsapp-teal-green/10 text-whatsapp-teal-green dark:bg-whatsapp-teal-green/20",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  resolved: "bg-gray-100 text-gray-500 dark:bg-dark-tertiary dark:text-dark-text-secondary",
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
