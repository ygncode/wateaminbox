import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

export type ConversationStatus = "open" | "pending" | "resolved";

/**
 * The current per-contact lifecycle projection. Mutating actions (resolve,
 * reopen, pending) live in conversation-case.service.ts - a case is the
 * source of truth, and this projection is kept in sync as a side effect of
 * every case transition. This module is read-only.
 */
export interface ConversationState {
  id: string;
  contactId: string;
  status: ConversationStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  resolutionNotes: string | null;
  activeCaseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Gets the current conversation state for a contact
 */
export async function getConversationState(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationState | null> {
  const state = await tenantDb
    .selectFrom("conversation_states")
    .selectAll()
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!state) return null;

  return {
    id: state.id,
    contactId: state.contact_id,
    status: state.status,
    resolvedAt: state.resolved_at,
    resolvedBy: state.resolved_by,
    reopenedAt: state.reopened_at,
    reopenedBy: state.reopened_by,
    resolutionNotes: state.resolution_notes,
    activeCaseId: state.active_case_id,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}
