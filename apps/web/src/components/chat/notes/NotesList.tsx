import { ChevronDown, ChevronUp, Lock, Plus, Users } from "lucide-react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNoteList } from "@/hooks/useNoteList";
import { NoteItem, type NoteItemNote } from "./NoteItem";
import { useTranslation } from "react-i18next";

export interface NotesListProps {
  /** Title for the section */
  title: string;
  /** Notes to display */
  notes: NoteItemNote[];
  /** Whether notes are loading */
  isLoading: boolean;
  /** Whether this is private (only visible to user) or shared */
  isPrivate: boolean;
  /** Current user ID for ownership check */
  currentUserId?: string;
  /** Whether any mutation is pending */
  isPending: boolean;
  /** Handler for creating a new note */
  onCreate: (content: string) => Promise<void>;
  /** Handler for editing a note */
  onEdit: (noteId: string, content: string) => Promise<void>;
  /** Handler for deleting a note */
  onDelete: (noteId: string) => Promise<void>;
}

/**
 * Generic notes list component that works for both private and shared notes
 * Handles loading state, add form, expand/collapse, and note CRUD operations
 */
export function NotesList({
  title,
  notes,
  isLoading,
  isPrivate,
  currentUserId,
  isPending,
  onCreate,
  onEdit,
  onDelete,
}: NotesListProps) {
  const { t } = useTranslation();

  const {
    showAddForm,
    setShowAddForm,
    newContent,
    setNewContent,
    isExpanded,
    toggleExpanded,
    handleCancel,
  } = useNoteList({ onSave: onCreate });

  const handleCreate = async () => {
    if (newContent.trim()) {
      await onCreate(newContent.trim());
      setNewContent("");
      setShowAddForm(false);
    }
  };

  if (isLoading) {
    return (
      <RightPanelSection title={title}>
        <Skeleton className="h-20 w-full" />
      </RightPanelSection>
    );
  }

  const Icon = isPrivate ? Lock : Users;
  const subtitle = isPrivate
    ? t("notes.privateSubtitle", "Only you can see these")
    : t("notes.sharedSubtitle", "Visible to all team members");
  const placeholder = isPrivate
    ? t("notes.privatePlaceholder", "Add a private note…")
    : t("notes.sharedPlaceholder", "Add a shared note…");
  const addButtonText = isPrivate
    ? t("notes.addPrivate", "Add private note")
    : t("notes.addShared", "Add shared note");

  return (
    <RightPanelSection title={title}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-fg-subtle" />
        <span className="text-xs text-fg-subtle">{subtitle}</span>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={toggleExpanded}
            className="ms-auto text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Hide
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Show ({notes.length})
              </>
            )}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              isOwner={isPrivate || note.userId === currentUserId}
              isSystem={!isPrivate && note.authorName === "System"}
              onEdit={onEdit}
              onDelete={onDelete}
              isPending={isPending}
              showAuthor={!isPrivate}
            />
          ))}

          {showAddForm ? (
            <div className="rounded-lg border border-line bg-surface p-3 space-y-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md border border-line-strong p-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={isPending || !newContent.trim()}
                  className="bg-primary hover:bg-primary-hover"
                >
                  {t("notes.addNote", "Add Note")}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 w-full p-2 rounded-lg border border-dashed border-line-strong text-sm text-fg-muted hover:border-line-strong hover:text-fg transition-colors"
            >
              <Plus className="h-4 w-4" />
              {addButtonText}
            </button>
          )}
        </div>
      )}
    </RightPanelSection>
  );
}
