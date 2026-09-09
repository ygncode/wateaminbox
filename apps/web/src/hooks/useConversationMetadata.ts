import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addConversationTag,
  assignConversation,
  createConversationNote,
  deleteConversationNote,
  getConversationAssignment,
  getConversationNotes,
  getConversationTags,
  removeConversationTag,
  unassignConversation,
  updateConversationNote,
} from "@/lib/api/channel-conversations";
import { queryKeys } from "./query-keys";

function notesKey(conversationId: string) {
  return [
    ...queryKeys.channelConversations.detail(conversationId),
    "notes",
  ] as const;
}

function tagsKey(conversationId: string) {
  return [
    ...queryKeys.channelConversations.detail(conversationId),
    "tags",
  ] as const;
}

function assignmentKey(conversationId: string) {
  return [
    ...queryKeys.channelConversations.detail(conversationId),
    "assignment",
  ] as const;
}

export function useConversationNotes(conversationId: string | null) {
  return useQuery({
    queryKey: notesKey(conversationId ?? ""),
    queryFn: () => getConversationNotes(conversationId!),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}

export function useConversationNoteMutations(conversationId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: notesKey(conversationId) });

  const createNote = useMutation({
    mutationFn: (input: {
      content: string;
      visibility: "shared" | "private";
    }) => createConversationNote(conversationId, input),
    onSuccess: invalidate,
  });
  const updateNote = useMutation({
    mutationFn: (input: { noteId: string; content: string }) =>
      updateConversationNote(conversationId, input.noteId, input.content),
    onSuccess: invalidate,
  });
  const deleteNote = useMutation({
    mutationFn: (noteId: string) =>
      deleteConversationNote(conversationId, noteId),
    onSuccess: invalidate,
  });
  return { createNote, updateNote, deleteNote };
}

export function useConversationTags(conversationId: string | null) {
  return useQuery({
    queryKey: tagsKey(conversationId ?? ""),
    queryFn: () => getConversationTags(conversationId!),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}

export function useConversationTagMutations(conversationId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: tagsKey(conversationId) });
  const addTag = useMutation({
    mutationFn: (tagId: string) => addConversationTag(conversationId, tagId),
    onSuccess: invalidate,
  });
  const removeTag = useMutation({
    mutationFn: (tagId: string) => removeConversationTag(conversationId, tagId),
    onSuccess: invalidate,
  });
  return { addTag, removeTag };
}

export function useConversationAssignment(conversationId: string | null) {
  return useQuery({
    queryKey: assignmentKey(conversationId ?? ""),
    queryFn: () => getConversationAssignment(conversationId!),
    enabled: Boolean(conversationId),
    staleTime: 15_000,
  });
}

export function useConversationAssignmentMutations(conversationId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: assignmentKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.chats.lists() });
    queryClient.invalidateQueries({
      queryKey: queryKeys.channelConversations.lists(),
    });
  };
  const assign = useMutation({
    mutationFn: (targetUserId?: string) =>
      assignConversation(conversationId, targetUserId),
    onSuccess: invalidate,
  });
  const unassign = useMutation({
    mutationFn: () => unassignConversation(conversationId),
    onSuccess: invalidate,
  });
  return { assign, unassign };
}
