import { useState, useEffect } from "react";
import {
  RightPanel,
  RightPanelHeader,
  RightPanelContent,
  RightPanelSection,
} from "@/components/layout/right-panel";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Input,
  Skeleton,
} from "@/components/ui";
import { ExportDialog } from "@/components/export";
import {
  useContact,
  useUpdateContact,
  usePrivateNotes,
  useSharedNotes,
  useCreatePrivateNote,
  useUpdatePrivateNote,
  useDeletePrivateNote,
  useCreateSharedNote,
  useUpdateSharedNote,
  useDeleteSharedNote,
  useTags,
  useAddContactTag,
  useRemoveContactTag,
  useAssignContact,
  useUnassignContact,
  useAssignmentHistory,
  type SharedNote,
  type PrivateNote,
} from "@/hooks/useContact";
import { useAuth } from "@/contexts/auth-context";
import {
  Phone,
  User,
  Edit2,
  Check,
  X,
  Lock,
  Tag,
  UserPlus,
  UserMinus,
  Plus,
  Download,
  History,
  ChevronDown,
  ChevronUp,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContactProfileProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Contact Profile Panel - shows detailed contact information
 * with editable fields for custom name, shared notes, and private notes
 */
export function ContactProfile({
  contactId,
  isOpen,
  onClose,
}: ContactProfileProps) {
  const { data: contact, isLoading, error } = useContact(contactId);
  const [showExportDialog, setShowExportDialog] = useState(false);

  if (!contactId) return null;

  return (
    <RightPanel isOpen={isOpen} onClose={onClose}>
      <RightPanelHeader title="Contact Info" onClose={onClose} />
      <RightPanelContent>
        {isLoading ? (
          <ContactProfileSkeleton />
        ) : error ? (
          <div className="p-4 text-center text-red-500 dark:text-red-400">
            Failed to load contact information
          </div>
        ) : contact ? (
          <>
            {/* Profile Header */}
            <ProfileHeader contact={contact} />

            {/* Contact Info Section */}
            <ContactInfoSection contact={contact} />

            {/* Custom Name Section */}
            <EditableNameSection contact={contact} />

            {/* Shared Notes Section - Now using the new list component */}
            <SharedNotesList contactId={contact.id} />

            {/* Private Notes Section - Now using the new list component */}
            <PrivateNotesList contactId={contact.id} />

            {/* Tags Section */}
            <TagsSection contact={contact} />

            {/* Assignment Section */}
            <AssignmentSection contact={contact} />

            {/* Assignment History Section */}
            <AssignmentHistorySection contactId={contact.id} />

            {/* Export Conversation Section */}
            <RightPanelSection title="Export">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
                  Download this conversation as CSV or JSON
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowExportDialog(true)}
                  className="gap-1 dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
                >
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </div>
            </RightPanelSection>

            {/* Export Dialog */}
            <ExportDialog
              open={showExportDialog}
              onOpenChange={setShowExportDialog}
              type="conversation"
              contactId={contact.id}
              contactName={contact.displayName}
            />
          </>
        ) : null}
      </RightPanelContent>
    </RightPanel>
  );
}

/**
 * Loading skeleton for the profile panel
 */
function ContactProfileSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center gap-4 py-8">
        <Skeleton className="h-32 w-32 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/**
 * Profile header with avatar and display name
 */
function ProfileHeader({
  contact,
}: {
  contact: NonNullable<ReturnType<typeof useContact>["data"]>;
}) {
  const initials = contact.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col items-center gap-4 bg-gray-50 dark:bg-dark-elevated py-8">
      <Avatar className="h-32 w-32 border-4 border-white dark:border-dark-tertiary shadow-lg">
        <AvatarImage
          src={contact.profilePictureUrl || undefined}
          alt={contact.displayName}
        />
        <AvatarFallback className="bg-whatsapp-teal-green text-3xl text-white">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
          {contact.displayName}
        </h3>
        {contact.customName && contact.pushName && (
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            ~{contact.pushName}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Contact info section showing phone number and JID
 */
function ContactInfoSection({
  contact,
}: {
  contact: NonNullable<ReturnType<typeof useContact>["data"]>;
}) {
  return (
    <RightPanelSection>
      <div className="space-y-3">
        {contact.phoneNumber && (
          <div className="flex items-center gap-3">
            <Phone className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                {contact.phoneNumber}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Phone
              </p>
            </div>
          </div>
        )}
        {contact.pushName && (
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                {contact.pushName}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                WhatsApp Name
              </p>
            </div>
          </div>
        )}
      </div>
    </RightPanelSection>
  );
}

/**
 * Editable custom name section
 */
function EditableNameSection({
  contact,
}: {
  contact: NonNullable<ReturnType<typeof useContact>["data"]>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [customName, setCustomName] = useState(contact.customName || "");
  const updateContact = useUpdateContact();

  useEffect(() => {
    setCustomName(contact.customName || "");
  }, [contact.customName]);

  const handleSave = async () => {
    await updateContact.mutateAsync({
      contactId: contact.id,
      customName: customName.trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setCustomName(contact.customName || "");
    setIsEditing(false);
  };

  return (
    <RightPanelSection title="Custom Name">
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Enter custom name"
            className="flex-1 dark:bg-dark-tertiary dark:border-dark-border dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSave}
            disabled={updateContact.isPending}
            className="h-8 w-8 dark:hover:bg-dark-tertiary"
          >
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCancel}
            className="h-8 w-8 dark:hover:bg-dark-tertiary"
          >
            <X className="h-4 w-4 text-red-600 dark:text-red-400" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-700 dark:text-dark-text-primary">
            {contact.customName || (
              <span className="text-gray-400 dark:text-dark-text-tertiary italic">
                No custom name set
              </span>
            )}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8 dark:hover:bg-dark-tertiary"
          >
            <Edit2 className="h-4 w-4 text-gray-500 dark:text-dark-text-secondary" />
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500 dark:text-dark-text-tertiary">
        Custom name is visible to all team members
      </p>
    </RightPanelSection>
  );
}

/**
 * Single note item component for displaying and editing a note
 */
function NoteItem({
  note,
  isOwner,
  isSystem,
  onEdit,
  onDelete,
  isPending,
  showAuthor,
}: {
  note: SharedNote | PrivateNote;
  isOwner: boolean;
  isSystem: boolean;
  onEdit: (noteId: string, content: string) => void;
  onDelete: (noteId: string) => void;
  isPending: boolean;
  showAuthor: boolean;
}) {
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
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  };

  if (isEditing) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-3 space-y-2">
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary p-2 text-sm focus:border-whatsapp-teal-green focus:outline-none focus:ring-1 focus:ring-whatsapp-teal-green resize-none"
          rows={3}
          autoFocus
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
            >
              <Edit2 className="h-3 w-3 text-gray-500 dark:text-dark-text-secondary" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(note.id)}
              disabled={isPending}
              className="h-6 w-6 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="h-3 w-3 text-red-500 dark:text-red-400" />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-dark-text-tertiary">
        {showAuthor && "authorName" in note && (
          <>
            <span
              className={cn(
                "font-medium",
                isSystem && "text-blue-600 dark:text-blue-400",
              )}
            >
              {note.authorName}
            </span>
            <span>•</span>
          </>
        )}
        <span>{formatDate(note.createdAt)}</span>
        {note.updatedAt !== note.createdAt && (
          <>
            <span>•</span>
            <span className="italic">edited</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shared notes list - visible to all team members
 */
function SharedNotesList({ contactId }: { contactId: string }) {
  const { user } = useAuth();
  const { data, isLoading } = useSharedNotes(contactId);
  const createNote = useCreateSharedNote();
  const updateNote = useUpdateSharedNote();
  const deleteNote = useDeleteSharedNote();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);

  const notes = data?.data || [];
  const isPending =
    createNote.isPending || updateNote.isPending || deleteNote.isPending;

  const handleCreate = async () => {
    if (newContent.trim()) {
      await createNote.mutateAsync({ contactId, content: newContent.trim() });
      setNewContent("");
      setShowAddForm(false);
    }
  };

  const handleEdit = async (noteId: string, content: string) => {
    await updateNote.mutateAsync({ contactId, noteId, content });
  };

  const handleDelete = async (noteId: string) => {
    await deleteNote.mutateAsync({ contactId, noteId });
  };

  if (isLoading) {
    return (
      <RightPanelSection title="Shared Notes">
        <Skeleton className="h-20 w-full" />
      </RightPanelSection>
    );
  }

  return (
    <RightPanelSection title="Shared Notes">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
        <span className="text-xs text-gray-500 dark:text-dark-text-tertiary">
          Visible to all team members
        </span>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
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
              isOwner={note.userId === user?.id}
              isSystem={note.authorName === "System"}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isPending={isPending}
              showAuthor
            />
          ))}

          {showAddForm ? (
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-3 space-y-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Add a shared note..."
                className="w-full rounded-md border border-gray-300 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary p-2 text-sm focus:border-whatsapp-teal-green focus:outline-none focus:ring-1 focus:ring-whatsapp-teal-green resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewContent("");
                  }}
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
              Add shared note
            </button>
          )}
        </div>
      )}
    </RightPanelSection>
  );
}

/**
 * Private notes list - only visible to current user
 */
function PrivateNotesList({ contactId }: { contactId: string }) {
  const { data, isLoading } = usePrivateNotes(contactId);
  const createNote = useCreatePrivateNote();
  const updateNote = useUpdatePrivateNote();
  const deleteNote = useDeletePrivateNote();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);

  const notes = data?.data || [];
  const isPending =
    createNote.isPending || updateNote.isPending || deleteNote.isPending;

  const handleCreate = async () => {
    if (newContent.trim()) {
      await createNote.mutateAsync({ contactId, content: newContent.trim() });
      setNewContent("");
      setShowAddForm(false);
    }
  };

  const handleEdit = async (noteId: string, content: string) => {
    await updateNote.mutateAsync({ contactId, noteId, content });
  };

  const handleDelete = async (noteId: string) => {
    await deleteNote.mutateAsync({ contactId, noteId });
  };

  if (isLoading) {
    return (
      <RightPanelSection title="Private Notes">
        <Skeleton className="h-20 w-full" />
      </RightPanelSection>
    );
  }

  return (
    <RightPanelSection title="Private Notes">
      <div className="flex items-center gap-2 mb-2">
        <Lock className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
        <span className="text-xs text-gray-500 dark:text-dark-text-tertiary">
          Only you can see these
        </span>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
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
              isOwner
              isSystem={false}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isPending={isPending}
              showAuthor={false}
            />
          ))}

          {showAddForm ? (
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-3 space-y-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Add a private note..."
                className="w-full rounded-md border border-gray-300 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary p-2 text-sm focus:border-whatsapp-teal-green focus:outline-none focus:ring-1 focus:ring-whatsapp-teal-green resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewContent("");
                  }}
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
              Add private note
            </button>
          )}
        </div>
      )}
    </RightPanelSection>
  );
}

/**
 * Tags section - display and manage contact tags
 */
function TagsSection({
  contact,
}: {
  contact: NonNullable<ReturnType<typeof useContact>["data"]>;
}) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const { data: allTags, isLoading: isLoadingTags } = useTags();
  const addTag = useAddContactTag();
  const removeTag = useRemoveContactTag();

  const contactTagIds = new Set(contact.tags.map((t) => t.id));
  const availableTags = allTags?.filter((t) => !contactTagIds.has(t.id)) || [];

  const handleAddTag = async (tagId: string) => {
    await addTag.mutateAsync({ contactId: contact.id, tagId });
    setShowTagPicker(false);
  };

  const handleRemoveTag = async (tagId: string) => {
    await removeTag.mutateAsync({ contactId: contact.id, tagId });
  };

  return (
    <RightPanelSection title="Tags">
      <div className="flex items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
        <div className="flex-1">
          <div className="flex flex-wrap gap-2">
            {contact.tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className={cn(
                  "group cursor-pointer pr-1",
                  tag.color && `bg-${tag.color}-100 text-${tag.color}-700`,
                )}
                style={
                  tag.color
                    ? { backgroundColor: `${tag.color}20`, color: tag.color }
                    : undefined
                }
              >
                {tag.name}
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  className="ml-1 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-black/10 dark:hover:bg-white/10 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <button
              onClick={() => setShowTagPicker(!showTagPicker)}
              className="flex h-6 items-center gap-1 rounded-full border border-dashed border-gray-300 dark:border-dark-border px-2 text-xs text-gray-500 dark:text-dark-text-secondary hover:border-gray-400 hover:text-gray-600 dark:hover:border-dark-text-tertiary dark:hover:text-dark-text-primary"
            >
              <Plus className="h-3 w-3" />
              Add Tag
            </button>
          </div>

          {showTagPicker && (
            <div className="mt-2 rounded-md border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-2 shadow-sm">
              {isLoadingTags ? (
                <Skeleton className="h-8 w-full" />
              ) : availableTags.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                  No more tags available
                </p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {availableTags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="cursor-pointer hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                      style={
                        tag.color
                          ? { borderColor: tag.color, color: tag.color }
                          : undefined
                      }
                      onClick={() => handleAddTag(tag.id)}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </RightPanelSection>
  );
}

/**
 * Assignment section - assign/unassign contact to current user
 */
function AssignmentSection({
  contact,
}: {
  contact: NonNullable<ReturnType<typeof useContact>["data"]>;
}) {
  const assignContact = useAssignContact();
  const unassignContact = useUnassignContact();

  const handleAssign = async () => {
    await assignContact.mutateAsync(contact.id);
  };

  const handleUnassign = async () => {
    await unassignContact.mutateAsync(contact.id);
  };

  return (
    <RightPanelSection title="Assignment">
      <div className="flex items-center justify-between">
        {contact.assignment ? (
          <>
            <div>
              <p className="text-sm text-gray-700 dark:text-dark-text-primary">
                Assigned to:{" "}
                <span className="font-medium">
                  {contact.assignment.assignedToName}
                </span>
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Since{" "}
                {new Date(contact.assignment.assignedAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUnassign}
              disabled={unassignContact.isPending}
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-400/50 dark:hover:bg-red-400/10 dark:hover:text-red-300"
            >
              <UserMinus className="mr-1 h-4 w-4" />
              Unassign
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm italic text-gray-400 dark:text-dark-text-tertiary">
              Not assigned to anyone
            </p>
            <Button
              size="sm"
              onClick={handleAssign}
              disabled={assignContact.isPending}
              className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              <UserPlus className="mr-1 h-4 w-4" />
              Assign to me
            </Button>
          </>
        )}
      </div>
    </RightPanelSection>
  );
}

/**
 * Assignment history section - shows past assignments
 */
function AssignmentHistorySection({ contactId }: { contactId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: history, isLoading } = useAssignmentHistory(contactId);

  if (isLoading) {
    return (
      <RightPanelSection title="Assignment History">
        <Skeleton className="h-12 w-full" />
      </RightPanelSection>
    );
  }

  if (!history || history.length === 0) {
    return (
      <RightPanelSection title="Assignment History">
        <div className="flex items-center gap-2 text-gray-400 dark:text-dark-text-tertiary">
          <History className="h-4 w-4" />
          <p className="text-sm italic">No assignment history</p>
        </div>
      </RightPanelSection>
    );
  }

  const displayedHistory = isExpanded ? history : history.slice(0, 3);

  return (
    <RightPanelSection title="Assignment History">
      <div className="space-y-2">
        {displayedHistory.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "flex items-start gap-3 rounded-lg p-2 text-sm",
              entry.isActive
                ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                : "bg-gray-50 dark:bg-dark-elevated",
            )}
          >
            <div className="mt-0.5">
              <History
                className={cn(
                  "h-4 w-4",
                  entry.isActive
                    ? "text-green-600 dark:text-green-400"
                    : "text-gray-400 dark:text-dark-text-tertiary",
                )}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 dark:text-dark-text-primary truncate">
                {entry.assignedToName}
                {entry.isActive && (
                  <Badge
                    variant="secondary"
                    className="ml-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs"
                  >
                    Active
                  </Badge>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                Assigned by {entry.assignedByName}
              </p>
              <p className="text-xs text-gray-400 dark:text-dark-text-tertiary">
                {new Date(entry.assignedAt).toLocaleDateString()} at{" "}
                {new Date(entry.assignedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {entry.unassignedAt && (
                  <>
                    {" → "}
                    {new Date(entry.unassignedAt).toLocaleDateString()} at{" "}
                    {new Date(entry.unassignedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      {history.length > 3 && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 mt-2 text-xs text-whatsapp-teal-green hover:text-whatsapp-dark-green font-medium"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Show all ({history.length} entries)
            </>
          )}
        </button>
      )}
    </RightPanelSection>
  );
}

export default ContactProfile;
