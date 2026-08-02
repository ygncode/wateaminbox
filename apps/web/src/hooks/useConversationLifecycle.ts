/**
 * Conversation lifecycle (case) hooks - the current state for the open
 * chat, plus Resolve/Pending/Reopen mutations. Cache invalidation covers
 * both the conversation-state detail and every chat-list filter variant
 * (Open/Pending/Resolved/All, and every assignment/search/connection
 * combination already cached), since a lifecycle change can move a contact
 * in or out of whichever list is currently shown.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError } from "@/lib/api/client";
import {
  getConversationState,
  openConversation,
  type ResolutionOutcome,
  reopenConversation,
  resolveConversation,
  resumeConversation,
  setConversationPending,
} from "@/lib/api/conversation-state";
import { queryKeys } from "./query-keys";

export function useConversationState(contactId: string | null) {
  return useQuery({
    queryKey: contactId
      ? queryKeys.conversations.detail(contactId)
      : queryKeys.conversations.details(),
    queryFn: () => {
      if (!contactId) throw new Error("No contact selected");
      return getConversationState(contactId);
    },
    enabled: !!contactId,
    staleTime: 1000 * 15,
  });
}

function useInvalidateLifecycleCaches(contactId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.detail(contactId),
    });
    // Every cached chat-list variant (status/assignment/search/connection
    // filters) can be affected by a lifecycle change, so invalidate the
    // whole "chats" list family rather than one specific filter key.
    queryClient.invalidateQueries({ queryKey: queryKeys.chats.lists() });
    // Resolve/pending/open/reopen all change response and/or resolution
    // SLA numbers - invalidate the whole "analytics" prefix rather than
    // one dashboard query, so every cached response-time/resolution view
    // picks it up. The realtime "conversation:updated" broadcast this
    // mutation triggers does the same for OTHER connected clients; this
    // covers the mutating client immediately, without waiting on its own
    // broadcast to round-trip back.
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
  };
}

export function useResolveConversation(contactId: string) {
  const invalidate = useInvalidateLifecycleCaches(contactId);
  return useMutation({
    mutationFn: (input: { outcome: ResolutionOutcome; notes?: string }) =>
      resolveConversation(contactId, input),
    onSuccess: () => {
      invalidate();
      toast.success("Conversation resolved");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Could not resolve conversation",
      );
    },
  });
}

/**
 * A 409 from /open or /reopen means this contact's actual case-history
 * state doesn't match what the UI's `hasCaseHistory` was showing (a stale
 * view raced a concurrent auto-reopen/resolve, or another agent's action) -
 * refetch immediately so the Open/Reopen control relabels itself correctly
 * instead of continuing to offer an action the server just rejected.
 */
function useRefetchOnStaleTransitionConflict(contactId: string) {
  const queryClient = useQueryClient();
  return (err: unknown) => {
    if (err instanceof ApiRequestError && err.statusCode === 409) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.detail(contactId),
      });
      toast.error(
        "This conversation's state changed - refreshed to the current status.",
      );
      return;
    }
    toast.error(err instanceof Error ? err.message : "Something went wrong");
  };
}

export function useReopenConversation(contactId: string) {
  const invalidate = useInvalidateLifecycleCaches(contactId);
  const handleStaleConflict = useRefetchOnStaleTransitionConflict(contactId);
  return useMutation({
    mutationFn: (input: { reason: string }) =>
      reopenConversation(contactId, input),
    onSuccess: () => {
      invalidate();
      toast.success("Conversation reopened");
    },
    onError: handleStaleConflict,
  });
}

export function useOpenConversation(contactId: string) {
  const invalidate = useInvalidateLifecycleCaches(contactId);
  const handleStaleConflict = useRefetchOnStaleTransitionConflict(contactId);
  return useMutation({
    mutationFn: (input: { reason?: string } = {}) =>
      openConversation(contactId, input),
    onSuccess: () => {
      invalidate();
      toast.success("Conversation opened");
    },
    onError: handleStaleConflict,
  });
}

export function usePendingConversation(contactId: string) {
  const invalidate = useInvalidateLifecycleCaches(contactId);
  return useMutation({
    mutationFn: () => setConversationPending(contactId),
    onSuccess: () => {
      invalidate();
      toast.success("Conversation marked pending");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Could not update conversation",
      );
    },
  });
}

/**
 * Resumes a pending case back to open - the SAME case, never a new one
 * (unlike useOpenConversation, which always starts a brand-new case for a
 * contact with no active case at all).
 */
export function useResumeConversation(contactId: string) {
  const invalidate = useInvalidateLifecycleCaches(contactId);
  return useMutation({
    mutationFn: () => resumeConversation(contactId),
    onSuccess: () => {
      invalidate();
      toast.success("Conversation reopened");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Could not update conversation",
      );
    },
  });
}
