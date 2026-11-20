import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuickReply } from "@/lib/api/types";
import { useTranslation } from "react-i18next";

interface QuickReplyCardProps {
  quickReply: QuickReply;
  onEdit: (qr: QuickReply) => void;
  onDelete: (id: string) => void;
}

/**
 * Quick Reply Card Component
 * Displays a single quick reply with shortcut, title, content, and actions
 */
export function QuickReplyCard({
  quickReply,
  onEdit,
  onDelete,
}: QuickReplyCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className="group flex items-start gap-3 rounded-xl border border-line bg-subtle p-3.5 transition-colors hover:border-line-strong hover:bg-muted focus-within:border-line-strong"
      data-testid={`quick-reply-item-${quickReply.shortcut}`}
    >
      {/* Shortcut badge */}
      <div className="flex-shrink-0">
        <span className="inline-flex items-center rounded-md bg-accent-soft px-2.5 py-1 font-mono text-xs font-semibold text-accent">
          /{quickReply.shortcut}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-fg truncate">{quickReply.title}</p>
        <p className="text-sm text-fg-muted line-clamp-2 mt-0.5">
          {quickReply.content}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(quickReply)}
          className="h-8 w-8 p-0"
          aria-label={`Edit ${quickReply.title}`}
          title={t("quickReplies.editAction", "Edit quick reply")}
          data-testid={`edit-quick-reply-${quickReply.shortcut}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(quickReply.id)}
          className="h-8 w-8 p-0 text-danger hover:text-danger hover:bg-danger-soft"
          aria-label={`Delete ${quickReply.title}`}
          title={t("quickReplies.deleteAction", "Delete quick reply")}
          data-testid={`delete-quick-reply-${quickReply.shortcut}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
