/**
 * Authorized fan-out for conversation-scoped realtime events.
 *
 * Every member is subscribed to `company:{companyId}`, so anything published
 * there is readable by the whole workspace. Events that name a conversation -
 * its messages, their status, its activity, or the contact's identity - must
 * therefore reach exactly the users allowed to read that conversation over
 * HTTP, or realtime becomes a side channel around `requireContactVisibility`.
 *
 * The predicate here is deliberately the same one the HTTP guard uses
 * (`hasContactVisibility` in middleware/resource-visibility.ts): a user may
 * read a contact's conversation when they have `can_view_all_chats`, or when
 * they hold that contact's active assignment. Routing every producer through
 * this module is what keeps the two in step.
 */

import { db } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import {
  broadcastToUsers,
  type ConversationRealtimeEventType,
  type UserFanOutOptions,
} from "../lib/realtime.js";
import {
  getEffectivePermissions,
  type MemberPermissions,
} from "./permission.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";

const logger = createLogger("ConversationBroadcast");

type TenantExecutor = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

export interface ContactViewerCandidate {
  userId: string;
  permissions: MemberPermissions;
}

export interface ContactFanOutOptions extends UserFanOutOptions {
  /**
   * Extra recipients to include beyond the current authorized viewers.
   *
   * Used for assignment transitions: the outgoing assignee is no longer a
   * viewer by the time the event is published, but still needs to be told
   * that the conversation left them.
   */
  alsoNotifyUserIds?: readonly (string | null | undefined)[];
}

/**
 * Pure visibility selector.
 *
 * @param assignedTo - the contact's current active assignee, or null when the
 *   contact is unassigned. An unassigned contact is visible only to members
 *   who can view all chats.
 */
export function selectContactViewerIds(input: {
  candidates: readonly ContactViewerCandidate[];
  assignedTo: string | null;
}): string[] {
  const viewers = new Set<string>();
  for (const candidate of input.candidates) {
    if (
      candidate.permissions.can_view_all_chats ||
      (input.assignedTo !== null && candidate.userId === input.assignedTo)
    ) {
      viewers.add(candidate.userId);
    }
  }
  return [...viewers];
}

/**
 * Resolve every user allowed to read the given contact's conversation.
 *
 * The assignment is read live rather than cached: it is the security-relevant
 * half of the predicate and it changes far more often than membership.
 */
export async function resolveContactViewerIds(
  companyId: string,
  contactId: string,
  executor: TenantExecutor = getTenantConnection(companyId),
): Promise<string[]> {
  const [members, assignment] = await Promise.all([
    db
      .selectFrom("company_members")
      .select(["user_id", "role", "permissions"])
      .where("company_id", "=", companyId)
      .execute(),
    executor
      .selectFrom("contact_assignments")
      .select("assigned_to")
      .where("contact_id", "=", contactId)
      .where("unassigned_at", "is", null)
      .executeTakeFirst(),
  ]);

  return selectContactViewerIds({
    assignedTo: assignment?.assigned_to ?? null,
    candidates: members.map((member) => ({
      userId: member.user_id,
      permissions: getEffectivePermissions(
        member.role as "owner" | "admin" | "member",
        (member.permissions ?? {}) as Partial<MemberPermissions>,
      ),
    })),
  });
}

/**
 * Union the resolved viewers with any explicitly named recipients.
 *
 * An assignment change has to reach the user who just *lost* visibility, or
 * their client keeps showing a conversation it may no longer open. The
 * resolver cannot know them - it only sees the new state - so callers name
 * them. Blanks are dropped and each recipient appears once.
 */
export function mergeFanOutRecipients(
  viewerIds: readonly string[],
  alsoNotifyUserIds: readonly (string | null | undefined)[] = [],
): string[] {
  const recipients = new Set(viewerIds);
  for (const userId of alsoNotifyUserIds) {
    if (userId) recipients.add(userId);
  }
  return [...recipients];
}

/**
 * Deliver a conversation-scoped event to that contact's authorized viewers.
 *
 * Resolution failures are logged and swallowed rather than propagated: the
 * state change is already committed by the time this runs, and realtime is an
 * update signal that clients reconcile against PostgreSQL. Failing closed (no
 * broadcast) is the safe direction - it costs a delayed UI update, never a
 * disclosure.
 */
export async function broadcastToContactViewers(
  companyId: string,
  contactId: string | null | undefined,
  eventType: ConversationRealtimeEventType,
  payload: unknown,
  options: ContactFanOutOptions = {},
): Promise<void> {
  // A row with no contact names no conversation, so there is nobody to
  // authorize; clients key these payloads on the conversation id and could not
  // route one without it either.
  if (!contactId) return;

  try {
    const recipients = mergeFanOutRecipients(
      await resolveContactViewerIds(companyId, contactId),
      options.alsoNotifyUserIds,
    );
    await broadcastToUsers(companyId, recipients, eventType, payload, options);
  } catch (error) {
    logger.error(
      { err: formatError(error), companyId, contactId, eventType },
      "Failed to fan out conversation event to authorized viewers",
    );
  }
}

/**
 * Same, for producers that only know the WhatsApp JID.
 *
 * Contact rows are per connection, so a JID can name more than one contact
 * across accounts. Every matching contact is resolved and the union of their
 * viewers receives the event, which mirrors what those users would see when
 * listing contacts over HTTP.
 */
export async function broadcastToContactViewersByJid(
  companyId: string,
  jid: string | null | undefined,
  eventType: ConversationRealtimeEventType,
  payload: unknown,
  options: UserFanOutOptions & {
    connectionId?: string;
    /**
     * Also reach the group conversations this JID participates in.
     *
     * A group participant usually has no standalone contact row of their own,
     * but their identity is rendered inside the group thread, so viewers of
     * those groups need the update.
     *
     * Resolved through `group_participants` rather than by scanning
     * `messages.sender_jid`: membership is the actual data model for "which
     * conversations is this JID part of", and that table is bounded by group
     * membership instead of growing with every message the tenant ever
     * received.
     */
    includeGroupMemberships?: boolean;
  } = {},
): Promise<void> {
  // An unnormalizable JID names no contact, so there is nobody to authorize
  // and the payload would be unusable to clients that key on it.
  if (!jid) return;

  try {
    const tenantDb = getTenantConnection(companyId);

    let directQuery = tenantDb
      .selectFrom("contacts")
      .select("id")
      .where("jid", "=", jid);
    if (options.connectionId) {
      directQuery = directQuery.where(
        "whatsapp_connection_id",
        "=",
        options.connectionId,
      );
    }

    const contactIds = new Set<string>(
      (await directQuery.execute()).map((row) => row.id),
    );

    if (options.includeGroupMemberships) {
      // Indexed on group_participants(participant_jid) - see migration 062.
      const memberships = await tenantDb
        .selectFrom("group_participants")
        .innerJoin("groups", "groups.id", "group_participants.group_id")
        .select("groups.contact_id")
        .distinct()
        .where("group_participants.participant_jid", "=", jid)
        .where("groups.contact_id", "is not", null)
        .execute();
      for (const row of memberships) {
        if (row.contact_id) contactIds.add(row.contact_id);
      }
    }

    if (contactIds.size === 0) return;

    const viewerIds = new Set<string>();
    for (const contactId of contactIds) {
      for (const userId of await resolveContactViewerIds(
        companyId,
        contactId,
        tenantDb,
      )) {
        viewerIds.add(userId);
      }
    }

    await broadcastToUsers(
      companyId,
      [...viewerIds],
      eventType,
      payload,
      options,
    );
  } catch (error) {
    logger.error(
      { err: formatError(error), companyId, jid, eventType },
      "Failed to fan out contact event to authorized viewers",
    );
  }
}

/** Back-compatible alias for the original message-only entry point. */
export async function broadcastNewMessageToViewers(
  companyId: string,
  contactId: string,
  payload: unknown,
  connectionId?: string,
): Promise<void> {
  await broadcastToContactViewers(
    companyId,
    contactId,
    "message:new",
    payload,
    { connectionId },
  );
}
