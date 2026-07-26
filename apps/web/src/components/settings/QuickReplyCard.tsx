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
      className="group flex items-start gap-3 rounded-xl border border-[#e2e8e3] bg-[#fbfcfb] p-3.5 transition-colors hover:border-[#c8d3cc] hover:bg-[#f8faf8] focus-within:border-[#a9beb3] dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.04]"
      data-testid={`quick-reply-item-${quickReply.shortcut}`}
    >
      {/* Shortcut badge */}
      <div className="flex-shrink-0">
        <span className="inline-flex items-center rounded-md bg-[#dcefe7] px-2.5 py-1 font-mono text-xs font-semibold text-[#087a5c] dark:bg-emerald-400/10 dark:text-emerald-300">
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
      <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(quickReply)}
          className="h-8 w-8 p-0"
          aria-label={`Edit ${quickReply.title}`}
          title="Edit quick reply"
          data-testid={`edit-quick-reply-${quickReply.shortcut}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(quickReply.id)}
          className="h-8 w-8 p-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
          aria-label={`Delete ${quickReply.title}`}
          title="Delete quick reply"
          data-testid={`delete-quick-reply-${quickReply.shortcut}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
