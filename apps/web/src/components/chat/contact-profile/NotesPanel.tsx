import { useAuth } from "@/contexts/auth-context";
import {
  useConversationNoteMutations,
  useConversationNotes,
} from "@/hooks/useConversationMetadata";
import {
  useCreatePrivateNote,
  useCreateSharedNote,
  useDeletePrivateNote,
  useDeleteSharedNote,
  usePrivateNotes,
  useSharedNotes,
  useUpdatePrivateNote,
  useUpdateSharedNote,
} from "@/hooks/useContact";
import { NotesList } from "../notes";
import { useTranslation } from "react-i18next";

interface NotesSectionProps {
  contactId: string;
}

/**
 * Shared notes section - wrapper around NotesList
 */
export function SharedNotesSection({ contactId }: NotesSectionProps) {
  const { t } = useTranslation();

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
      title={t("notes.sharedTitle", "Shared Notes")}
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
export function PrivateNotesSection({ contactId }: NotesSectionProps) {
  const { t } = useTranslation();

  const { data, isLoading } = usePrivateNotes(contactId);
  const createNote = useCreatePrivateNote();
  const updateNote = useUpdatePrivateNote();
  const deleteNote = useDeletePrivateNote();

  const notes = data?.data || [];
  const isPending =
    createNote.isPending || updateNote.isPending || deleteNote.isPending;

  return (
    <NotesList
      title={t("notes.privateTitle", "Private Notes")}
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

export function ConversationNotesSection({
  conversationId,
  visibility,
}: {
  conversationId: string;
  visibility: "shared" | "private";
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data = [], isLoading } = useConversationNotes(conversationId);
  const { createNote, updateNote, deleteNote } =
    useConversationNoteMutations(conversationId);
  const notes = data
    .filter((note) => note.visibility === visibility)
    .map((note) => ({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      authorName: note.authorName ?? undefined,
      userId: note.authorUserId,
    }));
  const isPending =
    createNote.isPending || updateNote.isPending || deleteNote.isPending;
  return (
    <NotesList
      title={
        visibility === "private"
          ? t("notes.privateTitle", "Private Notes")
          : t("notes.sharedTitle", "Shared Notes")
      }
      notes={notes}
      isLoading={isLoading}
      isPrivate={visibility === "private"}
      currentUserId={user?.id}
      isPending={isPending}
      onCreate={async (content) => {
        await createNote.mutateAsync({ content, visibility });
      }}
      onEdit={async (noteId, content) => {
        await updateNote.mutateAsync({ noteId, content });
      }}
      onDelete={async (noteId) => {
        await deleteNote.mutateAsync(noteId);
      }}
    />
  );
}
