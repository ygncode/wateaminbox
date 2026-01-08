import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Edit2,
  History,
  Phone,
  Plus,
  Tag,
  User,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatPhoneNumber } from "@/lib/utils";
import { formatShortDate, dayjs } from "@whatsapp-web/shared";
import { ExportDialog } from "@/components/export";
import {
  RightPanel,
  RightPanelContent,
  RightPanelHeader,
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
import { useAuth } from "@/contexts/auth-context";
import {
  useAddContactTag,
  useAssignContact,
  useAssignmentHistory,
  useContact,
  useCreatePrivateNote,
  useCreateSharedNote,
  useCreateTag,
  useDeletePrivateNote,
  useDeleteSharedNote,
  usePrivateNotes,
  useRemoveContactTag,
  useSharedNotes,
  useTags,
  useUnassignContact,
  useUpdateContact,
  useUpdatePrivateNote,
  useUpdateSharedNote,
} from "@/hooks/useContact";
import { cn } from "@/lib/utils";
import { NotesList } from "./notes";

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

            {/* Shared Notes Section */}
            <SharedNotesSection contactId={contact.id} />

            {/* Private Notes Section */}
            <PrivateNotesSection contactId={contact.id} />

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
                {formatPhoneNumber(contact.phoneNumber)}
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
 * Shared notes section - wrapper around NotesList
 */
function SharedNotesSection({ contactId }: { contactId: string }) {
  const { user } = useAuth();
  const { data, isLoading } = useSharedNotes(contactId);
  const createNote = useCreateSharedNote();
  const updateNote = useUpdateSharedNote();
  const deleteNote = useDeleteSharedNote();

  const notes = data?.data || [];
  const isPending =
    createNote.isPending || updateNote.isPending || deleteNote.isPending;

  return (
    <NotesList
      title="Shared Notes"
      notes={notes}
      isLoading={isLoading}
      isPrivate={false}
      currentUserId={user?.id}
      isPending={isPending}
      onCreate={async (content) => {
        await createNote.mutateAsync({ contactId, content });
      }}
      onEdit={async (noteId, content) => {
        await updateNote.mutateAsync({ contactId, noteId, content });
      }}
      onDelete={async (noteId) => {
        await deleteNote.mutateAsync({ contactId, noteId });
      }}
    />
  );
}

/**
 * Private notes section - wrapper around NotesList
 */
function PrivateNotesSection({ contactId }: { contactId: string }) {
  const { data, isLoading } = usePrivateNotes(contactId);
  const createNote = useCreatePrivateNote();
  const updateNote = useUpdatePrivateNote();
  const deleteNote = useDeletePrivateNote();

  const notes = data?.data || [];
  const isPending =
    createNote.isPending || updateNote.isPending || deleteNote.isPending;

  return (
    <NotesList
      title="Private Notes"
      notes={notes}
      isLoading={isLoading}
      isPrivate={true}
      isPending={isPending}
      onCreate={async (content) => {
        await createNote.mutateAsync({ contactId, content });
      }}
      onEdit={async (noteId, content) => {
        await updateNote.mutateAsync({ contactId, noteId, content });
      }}
      onDelete={async (noteId) => {
        await deleteNote.mutateAsync({ contactId, noteId });
      }}
    />
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
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const { data: allTags, isLoading: isLoadingTags } = useTags();
  const addTag = useAddContactTag();
  const removeTag = useRemoveContactTag();
  const createTag = useCreateTag();

  const contactTagIds = new Set(contact.tags.map((t) => t.id));
  const availableTags = allTags?.filter((t) => !contactTagIds.has(t.id)) || [];

  const handleAddTag = async (tagId: string) => {
    await addTag.mutateAsync({ contactId: contact.id, tagId });
    setShowTagPicker(false);
  };

  const handleRemoveTag = async (tagId: string) => {
    await removeTag.mutateAsync({ contactId: contact.id, tagId });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const newTag = await createTag.mutateAsync({ name: newTagName.trim() });
      setNewTagName("");
      setShowCreateTag(false);
      // Automatically add the newly created tag to the contact
      await addTag.mutateAsync({ contactId: contact.id, tagId: newTag.id });
      setShowTagPicker(false);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create tag";
      if (errorMessage.includes("already exists")) {
        toast.error("A tag with this name already exists");
      } else {
        toast.error(errorMessage);
      }
    }
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
              ) : (
                <>
                  {availableTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
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

                  {showCreateTag ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        placeholder="Enter tag name..."
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCreateTag();
                          } else if (e.key === "Escape") {
                            setShowCreateTag(false);
                            setNewTagName("");
                          }
                        }}
                        className="h-7 text-xs flex-1"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim() || createTag.isPending}
                        className="h-7 px-2 text-xs"
                      >
                        {createTag.isPending ? "..." : "Create"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowCreateTag(false);
                          setNewTagName("");
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCreateTag(true)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Create new tag
                    </button>
                  )}
                </>
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
                Since {formatShortDate(contact.assignment.assignedAt)}
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
              <div className="flex items-center font-medium text-gray-800 dark:text-dark-text-primary">
                <span className="truncate">{entry.assignedToName}</span>
                {entry.isActive && (
                  <Badge
                    variant="secondary"
                    className="ml-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs shrink-0"
                  >
                    Active
                  </Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                Assigned by {entry.assignedByName}
              </p>
              <p className="text-xs text-gray-400 dark:text-dark-text-tertiary">
                {dayjs(entry.assignedAt).format("MMM D")} at{" "}
                {dayjs(entry.assignedAt).format("HH:mm")}
                {entry.unassignedAt && (
                  <>
                    {" -> "}
                    {dayjs(entry.unassignedAt).format("MMM D")} at{" "}
                    {dayjs(entry.unassignedAt).format("HH:mm")}
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
