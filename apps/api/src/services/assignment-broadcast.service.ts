/**
 * Single shared source for every `contact:updated` assignment-change
 * broadcast, so the realtime event, contact-name lookup, and payload shape
 * can never drift between the assignment route (explicit assign/reassign/
 * unassign) and every `requireSendAccess` auto-claim call site (compose,
 * forward, retry, conversation-send, schedule-create).
 */

import { getContactDisplayName } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import { broadcastToCompany } from "../lib/realtime.js";
import type { TenantDatabase } from "./tenant.service.js";

export type ContactAssignmentEvent = "assigned" | "reassigned" | "unassigned";

export interface ContactAssignmentBroadcastParams {
  event: ContactAssignmentEvent;
  contactId: string;
  contactName: string;
  previousAssignee: string | null;
  newAssignee: string | null;
  assignedBy: string;
}

export async function broadcastContactAssignmentEvent(
  companyId: string,
  params: ContactAssignmentBroadcastParams,
): Promise<void> {
  await broadcastToCompany(companyId, "contact:updated", {
    event: params.event,
    contactId: params.contactId,
    contactName: params.contactName,
    previousAssignee: params.previousAssignee,
    newAssignee: params.newAssignee,
    assignedBy: params.assignedBy,
  });
}

/**
 * Broadcasts the first-ever claim of an unassigned contact that
 * `requireSendAccess` made as a side effect (autoAssigned: true) - every
 * connected client's composer gate (and the sender's own) needs to react to
 * it exactly like an explicit self-assign would, so this must fire for every
 * call site that can auto-claim, not just the ones a human clicked through
 * the assignment route.
 */
export async function broadcastAutoAssignment(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  contactId: string,
  userId: string,
): Promise<void> {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["custom_name", "push_name", "phone_number"])
    .where("id", "=", contactId)
    .executeTakeFirst();
  const contactName = contact
    ? getContactDisplayName(contact, "Unknown Contact")
    : "Unknown Contact";

  await broadcastContactAssignmentEvent(companyId, {
    event: "assigned",
    contactId,
    contactName,
    previousAssignee: null,
    newAssignee: userId,
    assignedBy: userId,
  });
}
