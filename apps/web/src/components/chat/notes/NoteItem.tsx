import { Edit2, Trash2 } from "lucide-react";
import { useState } from "react";
import { dayjs } from "@wateaminbox/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NoteItemNote {
  id: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  authorName?: string;
  userId?: string;
}

export interface NoteItemProps {
  note: NoteItemNote;
  isOwner: boolean;
  isSystem?: boolean;
  onEdit: (noteId: string, content: string) => void;
  onDelete: (noteId: string) => void;
  isPending: boolean;
  showAuthor?: boolean;
}

/**
 * Single note item component for displaying and editing a note
 * Supports both private and shared notes
 */
export function NoteItem({
  note,
  isOwner,
  isSystem = false,
  onEdit,
  onDelete,
  isPending,
  showAuthor = false,
}: NoteItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content || "");

  const handleSave = () => {
    if (editContent.trim()) {
      onEdit(note.id, editContent.trim());
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditContent(note.content || "");
    setIsEditing(false);
  };

  const formatDate = (dateStr: string) => {
    const parsed = dayjs(dateStr);
    const showYear = parsed.year() !== dayjs().year();
    return showYear ? parsed.format("MMM D, YYYY") : parsed.format("MMM D");
  };

  if (isEditing) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-3 space-y-2">
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary p-2 text-sm focus:border-whatsapp-teal-green focus:outline-none focus:ring-1 focus:ring-whatsapp-teal-green resize-none"
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={isPending}
            className="dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || !editContent.trim()}
            className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-dark-text-primary flex-1">
          {note.content}
        </p>
        {isOwner && !isSystem && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="h-6 w-6 dark:hover:bg-dark-tertiary"
              aria-label="Edit note"
            >
              <Edit2
                className="h-3 w-3 text-gray-500 dark:text-dark-text-secondary"
                aria-hidden="true"
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(note.id)}
              disabled={isPending}
              className="h-6 w-6 hover:bg-red-50 dark:hover:bg-red-900/20"
              aria-label="Delete note"
            >
              <Trash2
                className="h-3 w-3 text-red-500 dark:text-red-400"
                aria-hidden="true"
              />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-dark-text-tertiary">
        {showAuthor && note.authorName && (
          <>
            <span
              className={cn(
                "font-medium",
                isSystem && "text-blue-600 dark:text-blue-400",
              )}
            >
              {note.authorName}
            </span>
            <span>-</span>
          </>
        )}
        <span>{formatDate(note.createdAt)}</span>
        {note.updatedAt !== note.createdAt && (
          <>
            <span>-</span>
            <span className="italic">edited</span>
          </>
        )}
      </div>
    </div>
  );
}
