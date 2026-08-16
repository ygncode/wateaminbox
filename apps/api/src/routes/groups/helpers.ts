/**
 * Group Route Helpers
 *
 * One place to answer "may this request act on this group, right now?".
 *
 * Every group administration route needs the same five answers, and getting any
 * of them from a different source is a security or correctness bug:
 *
 *  - Which connection owns the group. Admin rights belong to a WhatsApp
 *    identity, so they must be evaluated against the account that is actually
 *    in the group - never against whichever connection happens to be online.
 *  - Whether that connection is currently usable, so a command is not queued
 *    against a worker that cannot run it.
 *  - Whether the connected account is still a member.
 *  - Whether it is an admin of that group.
 *  - The group's own JID and row ids.
 *
 * `loadGroupContext` returns all of them or an error response, and fails closed
 * whenever anything is missing.
 */
import { normalizeJid } from "@wateaminbox/shared";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { getRouteContext } from "../../middleware/context.js";
import type { TenantDatabase } from "../../services/tenant.service.js";

export interface GroupContext {
  /** `contacts.id` - the id every group route is addressed by. */
  contactId: string;
  /** `groups.id`. */
  groupId: string;
  /** The group's WhatsApp JID, normalized. */
  groupJid: string;
  groupName: string | null;
  /** Member count as last confirmed by WhatsApp. */
  participantCount: number;
  /** The connection that owns this group's conversation. */
  connectionId: string;
  /** That connection's own WhatsApp JID, normalized. */
  connectionJid: string | null;
  /** Whether the connected account is still in the group. */
  isMember: boolean;
  /** Whether the connected account is an admin of this group. */
  isAdmin: boolean;
}

export interface LoadGroupOptions {
  /**
   * Require a live connection. Read-only routes leave this off so group details
   * remain visible while the phone is offline.
   */
  requireConnected?: boolean;
  /** Require the connected account to still be a member. */
  requireMembership?: boolean;
  /** Require the connected account to be a group admin. */
  requireAdmin?: boolean;
  /** Verb used in the "only admins can ..." message. */
  adminAction?: string;
}

/** Either a resolved context or the response to return instead. */
export type GroupContextResult =
  | { ok: true; context: GroupContext }
  | { ok: false; response: Response };

/**
 * Read a group's administration context for the current request.
 *
 * Contact visibility has already been enforced by `requireContactVisibility` on
 * the router, so a caller reaching here is allowed to see the conversation; what
 * remains is whether WhatsApp would let this account perform the action.
 */
export async function loadGroupContext(
  c: Context,
  contactId: string,
  options: LoadGroupOptions = {},
): Promise<GroupContextResult> {
  const { tenantDb } = getRouteContext(c);

  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return { ok: false, response: notFound(c, "Group") };
  }

  const group = await tenantDb
    .selectFrom("groups")
    .select(["id", "name", "is_member", "participant_count"])
    .where("contact_id", "=", contact.id)
    .executeTakeFirst();

  if (!group) {
    // The conversation exists but WhatsApp has not synced the group yet, so
    // there is nothing to authorize an admin action against.
    return { ok: false, response: notFound(c, "Group details") };
  }

  if (!contact.whatsapp_connection_id) {
    return {
      ok: false,
      response: badRequest(
        c,
        "Group is not associated with any WhatsApp connection",
      ),
    };
  }

  // Read the group's OWN connection. Resolving the "current" connection any
  // other way would evaluate admin rights against an identity that may not even
  // be in this group.
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "jid", "status", "archived_at"])
    .where("id", "=", contact.whatsapp_connection_id)
    .executeTakeFirst();

  if (!connection || connection.archived_at !== null) {
    return {
      ok: false,
      response: badRequest(
        c,
        "The WhatsApp connection for this group is no longer available",
      ),
    };
  }

  if (options.requireConnected && connection.status !== "connected") {
    return {
      ok: false,
      response: conflict(
        c,
        "The WhatsApp account for this group is not connected",
      ),
    };
  }

  const connectionJid = normalizeJid(connection.jid);
  const groupJid = normalizeJid(contact.jid) ?? contact.jid;

  // Admin status is a property of the connected account's membership row. With
  // no known account JID it is unknowable, so it stays false and any route that
  // requires it is refused rather than allowed through.
  const membership = connectionJid
    ? await tenantDb
        .selectFrom("group_participants")
        .select(["is_admin"])
        .where("group_id", "=", group.id)
        .where("participant_jid", "=", connectionJid)
        .executeTakeFirst()
    : undefined;

  const context: GroupContext = {
    contactId: contact.id,
    groupId: group.id,
    groupJid,
    groupName: group.name,
    participantCount: group.participant_count,
    connectionId: connection.id,
    connectionJid,
    isMember: group.is_member,
    isAdmin: membership?.is_admin ?? false,
  };

  if (options.requireMembership && !context.isMember) {
    return {
      ok: false,
      response: conflict(
        c,
        "This WhatsApp account is no longer a member of the group",
      ),
    };
  }

  if (options.requireAdmin && !context.isAdmin) {
    const action = options.adminAction ?? "perform this action";
    return {
      ok: false,
      response: forbidden(c, `Only group admins can ${action}`),
    };
  }

  return { ok: true, context };
}

/**
 * Which of the supplied JIDs are currently members of the group.
 *
 * Callers use this to reject a request that names someone WhatsApp would not
 * accept - promoting a non-member, or adding somebody who is already in.
 */
export async function getGroupMemberJids(
  tenantDb: Kysely<TenantDatabase>,
  groupId: string,
  participantJids: string[],
): Promise<Set<string>> {
  if (participantJids.length === 0) return new Set();
  const rows = await tenantDb
    .selectFrom("group_participants")
    .select(["participant_jid"])
    .where("group_id", "=", groupId)
    .where("participant_jid", "in", participantJids)
    .execute();
  return new Set(rows.map((row) => row.participant_jid));
}

/** Members of the group that currently hold admin rights. */
export async function getGroupAdminJids(
  tenantDb: Kysely<TenantDatabase>,
  groupId: string,
  participantJids: string[],
): Promise<Set<string>> {
  if (participantJids.length === 0) return new Set();
  const rows = await tenantDb
    .selectFrom("group_participants")
    .select(["participant_jid"])
    .where("group_id", "=", groupId)
    .where("participant_jid", "in", participantJids)
    .where("is_admin", "=", true)
    .execute();
  return new Set(rows.map((row) => row.participant_jid));
}
