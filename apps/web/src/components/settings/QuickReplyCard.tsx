import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuickReply } from "@/lib/api/types";

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
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-dark-text-tertiary hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors group"
      data-testid={`quick-reply-item-${quickReply.shortcut}`}
    >
      {/* Shortcut badge */}
      <div className="flex-shrink-0">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-gray-100 dark:bg-dark-tertiary text-gray-700 dark:text-dark-text-primary">
          /{quickReply.shortcut}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
          {quickReply.title}
        </p>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary line-clamp-2 mt-0.5">
          {quickReply.content}
        </p>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(quickReply)}
          className="h-8 w-8 p-0"
          data-testid={`edit-quick-reply-${quickReply.shortcut}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(quickReply.id)}
          className="h-8 w-8 p-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
          data-testid={`delete-quick-reply-${quickReply.shortcut}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
