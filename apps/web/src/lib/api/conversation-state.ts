/**
 * Conversation lifecycle (case) API.
 *
 * A resolve/reopen/pending action changes the contact's active
 * conversation_cases row server-side; the server is authoritative on
 * permissions (can_send_messages) and on all validation (required outcome,
 * notes-required-for-"other", one active case per contact).
 */

import { api } from "./client";

export type ConversationLifecycleStatus = "open" | "pending" | "resolved";

export type ResolutionOutcome =
  | "handled"
  | "no_reply_needed"
  | "spam"
  | "duplicate"
  | "other";

export interface ConversationCase {
  id: string;
  contactId: string;
  kind: "direct" | "group";
  status: ConversationLifecycleStatus;
  openedAt: string;
  openingMessageId: string | null;
  policyId: string;
  responseTargetMinutes: number;
  resolutionTargetMinutes: number;
  reopenedFromCaseId: string | null;
  reopenReason: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionOutcome: ResolutionOutcome | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationStateResponse {
  contactId: string;
  status: ConversationLifecycleStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  resolutionNotes: string | null;
  activeCaseId: string | null;
  activeCase: ConversationCase | null;
  /**
   * True once this contact has ever had a conversation_cases row (open or
   * resolved). Distinguishes a genuine first-ever manual Open (no prior
   * case, reason optional) from a Reopen of a previously-closed
   * conversation (reason required) - see POST /open vs /reopen.
   */
  hasCaseHistory: boolean;
}

export async function getConversationState(
  contactId: string,
): Promise<ConversationStateResponse> {
  return api.get<ConversationStateResponse>(
    `/conversations/${contactId}/state`,
  );
}

export async function resolveConversation(
  contactId: string,
  input: { outcome: ResolutionOutcome; notes?: string },
): Promise<ConversationCase> {
  return api.post<ConversationCase>(
    `/conversations/${contactId}/resolve`,
    input,
  );
}

export async function reopenConversation(
  contactId: string,
  input: { reason: string },
): Promise<ConversationCase> {
  return api.post<ConversationCase>(
    `/conversations/${contactId}/reopen`,
    input,
  );
}

/**
 * Manually opens a conversation that has never had a case. Reason is
 * optional - there's no prior closure to justify. Use `reopenConversation`
 * instead when `hasCaseHistory` is true (a prior, resolved case exists).
 */
export async function openConversation(
  contactId: string,
  input: { reason?: string } = {},
): Promise<ConversationCase> {
  return api.post<ConversationCase>(`/conversations/${contactId}/open`, input);
}

export async function setConversationPending(
  contactId: string,
): Promise<ConversationCase> {
  return api.post<ConversationCase>(`/conversations/${contactId}/pending`);
}

/**
 * Resumes a pending case back to open - the SAME case, never a new one.
 * Distinct from `openConversation`, which always starts a brand-new case.
 */
export async function resumeConversation(
  contactId: string,
): Promise<ConversationCase> {
  return api.post<ConversationCase>(`/conversations/${contactId}/resume`);
}
