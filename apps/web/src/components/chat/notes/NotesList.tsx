import { ChevronDown, ChevronUp, Lock, Plus, Users } from "lucide-react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button, Skeleton } from "@/components/ui";
import { useNoteList } from "@/hooks/useNoteList";
import { NoteItem, type NoteItemNote } from "./NoteItem";

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
    ? "Only you can see these"
    : "Visible to all team members";
  const placeholder = isPrivate
    ? "Add a private note..."
    : "Add a shared note...";
  const addButtonText = isPrivate ? "Add private note" : "Add shared note";

  return (
    <RightPanelSection title={title}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
        <span className="text-xs text-gray-500 dark:text-dark-text-tertiary">
          {subtitle}
        </span>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={toggleExpanded}
            className="ml-auto text-xs text-whatsapp-teal-green hover:text-whatsapp-dark-green font-medium flex items-center gap-1"
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
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-3 space-y-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={placeholder}
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
                  onClick={handleCreate}
                  disabled={isPending || !newContent.trim()}
                  className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
                >
                  Add Note
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 w-full p-2 rounded-lg border border-dashed border-gray-300 dark:border-dark-border text-sm text-gray-500 dark:text-dark-text-secondary hover:border-gray-400 hover:text-gray-600 dark:hover:border-dark-text-tertiary dark:hover:text-dark-text-primary transition-colors"
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
