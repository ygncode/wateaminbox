import {
  type ContactSuppressionScope,
  SYSTEM_SUPPRESSION_ACTOR,
  type TenantDatabase,
} from "@wateaminbox/database";
import { type Kysely, sql, type Transaction } from "kysely";

/**
 * Customer suppression: the workspace's own decision about a person, applied
 * on every channel they use. See docs/contact-blocking-and-inbound-abuse-plan.md.
 *
 * Two facts are kept apart on purpose:
 *
 * - `contact_suppressions` is the workspace decision ("we blocked this
 *   person"). It is authoritative and provider-independent, because most
 *   providers - a Telegram bot, LINE, Viber, email - cannot block anyone.
 * - `endpoint_account_states.provider_block_state` is a provider fact about
 *   one endpoint on one account. It never creates a suppression.
 *
 * A suppression is stored on the contact it was applied to and read across the
 * customer's whole merge group (the surviving contact plus every contact merged
 * into it). That makes merge and unmerge correct without moving any rows:
 * blocking either half blocks the merged customer, and unmerging hands each
 * half back exactly what it had.
 */

type PolicyDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

export const SUPPRESSION_SCOPES = [
  "block",
  "mute_inbound",
  "do_not_contact",
] as const satisfies readonly ContactSuppressionScope[];

/** Same bound the merge alias resolver uses; a deeper chain is corrupt. */
const MAX_MERGE_DEPTH = 8;

export class SuppressionTargetError extends Error {}

export interface ActiveSuppression {
  id: string;
  contactId: string;
  scope: ContactSuppressionScope;
  reason: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
}

/**
 * Every contact ID in the merge group that `contactId` belongs to, surviving
 * contact first. Unknown contacts and cyclic or over-deep chains yield `[]`, so
 * a caller can never attach policy to an arbitrary row.
 */
export async function contactMergeGroup(
  db: PolicyDb,
  contactId: string,
): Promise<string[]> {
  // Walk up to the surviving contact. Tenant handles qualify tables through
  // withSchema(), which raw recursive SQL would bypass, so this stays in the
  // query builder; merge chains are bounded and short.
  let survivor: string | null = null;
  let current = contactId;
  const seen = new Set<string>();
  for (let depth = 0; depth <= MAX_MERGE_DEPTH; depth++) {
    if (seen.has(current)) return [];
    seen.add(current);
    const row = await db
      .selectFrom("contacts")
      .select(["id", "merged_into_contact_id"])
      .where("id", "=", current)
      .executeTakeFirst();
    if (!row) return [];
    if (!row.merged_into_contact_id) {
      survivor = row.id;
      break;
    }
    current = row.merged_into_contact_id;
  }
  if (!survivor) return [];

  // Then collect everything merged into it, breadth-first.
  const group = [survivor];
  const visited = new Set(group);
  let frontier = [survivor];
  for (let depth = 0; depth < MAX_MERGE_DEPTH && frontier.length > 0; depth++) {
    const children = await db
      .selectFrom("contacts")
      .select("id")
      .where("merged_into_contact_id", "in", frontier)
      .orderBy("id")
      .execute();
    frontier = [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      group.push(child.id);
      frontier.push(child.id);
    }
  }
  return group;
}

/** Active (not revoked, not expired) suppressions for a customer's merge group. */
export async function activeSuppressions(
  db: PolicyDb,
  contactId: string,
  now: Date = new Date(),
): Promise<ActiveSuppression[]> {
  const group = await contactMergeGroup(db, contactId);
  if (group.length === 0) return [];
  const rows = await db
    .selectFrom("contact_suppressions")
    .select([
      "id",
      "contact_id",
      "scope",
      "reason",
      "created_by",
      "created_at",
      "expires_at",
    ])
    .where("contact_id", "in", group)
    .where("revoked_at", "is", null)
    .where((eb) =>
      eb.or([eb("expires_at", "is", null), eb("expires_at", ">", now)]),
    )
    .orderBy("created_at")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    scope: row.scope,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

export type InboundPolicy =
  | { action: "accept" }
  | {
      action: "drop" | "silence";
      reason: "suppressed" | "provider_blocked";
      suppressionId?: string;
      /** The sender's customer, when the endpoint belongs to one. */
      contactId: string | null;
    };

/**
 * What to do with an inbound event from `senderEndpointId` on this account.
 *
 * - `drop`: a `block` on the sender's customer, or the provider says this
 *   account has the endpoint blocked. Store nothing.
 * - `silence`: a `mute_inbound`. Store it, but raise no unread count,
 *   notification, assignment or auto-reply.
 *
 * Only direct conversations are gated. A person block does not silence a
 * group: the group is everyone else's conversation too, and group moderation
 * is a separate feature.
 */
export async function resolveInboundPolicy(
  db: PolicyDb,
  input: {
    channelAccountId: string;
    senderEndpointId: string | null;
    conversationKind: "direct" | "group" | "thread";
    now?: Date;
  },
): Promise<InboundPolicy> {
  if (!input.senderEndpointId || input.conversationKind !== "direct") {
    return { action: "accept" };
  }
  const endpoint = await db
    .selectFrom("contact_endpoints as endpoint")
    .leftJoin("endpoint_account_states as state", (join) =>
      join
        .onRef("state.contact_endpoint_id", "=", "endpoint.id")
        .on("state.channel_account_id", "=", input.channelAccountId),
    )
    .select(["endpoint.contact_id", "state.provider_block_state"])
    .where("endpoint.id", "=", input.senderEndpointId)
    .executeTakeFirst();
  if (!endpoint) return { action: "accept" };

  const suppressions = endpoint.contact_id
    ? await activeSuppressions(db, endpoint.contact_id, input.now)
    : [];
  const contactId = endpoint.contact_id;
  const block = suppressions.find((row) => row.scope === "block");
  if (block) {
    return {
      action: "drop",
      reason: "suppressed",
      suppressionId: block.id,
      contactId,
    };
  }
  if (endpoint.provider_block_state === "blocked") {
    return { action: "drop", reason: "provider_blocked", contactId };
  }
  const mute = suppressions.find((row) => row.scope === "mute_inbound");
  if (mute) {
    return {
      action: "silence",
      reason: "suppressed",
      suppressionId: mute.id,
      contactId,
    };
  }
  return { action: "accept" };
}

export type OutboundPolicy =
  | { allowed: true }
  | {
      allowed: false;
      reasonCode: "contact_blocked" | "contact_do_not_contact";
    };

/**
 * Whether the workspace may send to this conversation's customer.
 *
 * `contacts.is_blocked` on the conversation's own contact still counts: on the
 * legacy WhatsApp path it mirrors the phone's blocklist, which a suppression
 * does not replace until that path is neutral.
 */
export async function resolveOutboundPolicy(
  db: PolicyDb,
  input: { conversationId: string; now?: Date },
): Promise<OutboundPolicy> {
  return resolveConversationOutboundPolicy(db, input);
}

/**
 * Outbound policy for a customer contact, by its own ID (the legacy send
 * paths are contact-keyed). Same rule as the conversation form.
 */
export async function resolveContactOutboundPolicy(
  db: PolicyDb,
  input: { contactId: string; now?: Date },
): Promise<OutboundPolicy> {
  const suppressions = await activeSuppressions(db, input.contactId, input.now);
  if (suppressions.some((row) => row.scope === "block")) {
    return { allowed: false, reasonCode: "contact_blocked" };
  }
  if (suppressions.some((row) => row.scope === "do_not_contact")) {
    return { allowed: false, reasonCode: "contact_do_not_contact" };
  }
  return { allowed: true };
}

/**
 * Whether this workspace enforces customer suppression. Off unless an
 * operator turned it on; a missing row (a schema not yet migrated) is off.
 */
export async function isSuppressionEnforced(db: PolicyDb): Promise<boolean> {
  const row = await db
    .selectFrom("contact_policy_settings")
    .select("enforcement_enabled")
    .where("id", "=", 1)
    .executeTakeFirst();
  return row?.enforcement_enabled === true;
}

/**
 * Count one inbound message dropped because its sender is blocked. Only a
 * counter per person, channel and UTC day is kept - never the content.
 */
export async function recordSuppressedInbound(
  db: PolicyDb,
  input: { contactId: string; channel: string; at?: Date },
): Promise<void> {
  const at = input.at ?? new Date();
  const day = at.toISOString().slice(0, 10);
  await db
    .insertInto("contact_suppression_drops")
    .values({
      contact_id: input.contactId,
      channel: input.channel,
      day,
      dropped_count: 1,
      last_dropped_at: at,
    })
    .onConflict((conflict) =>
      conflict.columns(["contact_id", "channel", "day"]).doUpdateSet((eb) => ({
        dropped_count: sql<number>`LEAST(${eb.ref("contact_suppression_drops.dropped_count")} + 1, 2147483647)`,
        last_dropped_at: at,
      })),
    )
    .execute();
}

async function resolveConversationOutboundPolicy(
  db: PolicyDb,
  input: { conversationId: string; now?: Date },
): Promise<OutboundPolicy> {
  const conversation = await db
    .selectFrom("conversations")
    .leftJoin("contacts", "contacts.id", "conversations.legacy_contact_id")
    .select(["conversations.legacy_contact_id", "contacts.is_blocked"])
    .where("conversations.id", "=", input.conversationId)
    .executeTakeFirst();
  if (!conversation?.legacy_contact_id) return { allowed: true };
  if (conversation.is_blocked) {
    return { allowed: false, reasonCode: "contact_blocked" };
  }
  const suppressions = await activeSuppressions(
    db,
    conversation.legacy_contact_id,
    input.now,
  );
  if (suppressions.some((row) => row.scope === "block")) {
    return { allowed: false, reasonCode: "contact_blocked" };
  }
  if (suppressions.some((row) => row.scope === "do_not_contact")) {
    return { allowed: false, reasonCode: "contact_do_not_contact" };
  }
  return { allowed: true };
}

/**
 * Apply a suppression to a customer. Idempotent: an already-active suppression
 * of the same scope anywhere in the merge group is returned unchanged.
 *
 * The new row is stored on the surviving contact. Groups cannot be suppressed.
 * Run inside the caller's transaction so the decision commits with its audit
 * and any provider command.
 */
export async function applySuppression(
  trx: Transaction<TenantDatabase>,
  input: {
    contactId: string;
    scope: ContactSuppressionScope;
    reason: string;
    actorUserId: string;
    expiresAt?: Date | null;
    now?: Date;
  },
): Promise<{ suppressionId: string; created: boolean }> {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (!reason)
    throw new SuppressionTargetError("Suppression reason is required");
  if (input.expiresAt && input.expiresAt <= now) {
    throw new SuppressionTargetError("Suppression must expire in the future");
  }
  const group = await contactMergeGroup(trx, input.contactId);
  const survivorId = group[0];
  if (!survivorId) throw new SuppressionTargetError("Contact not found");

  // Serialize decisions about this customer: lock the whole merge group.
  const members = await trx
    .selectFrom("contacts")
    .select(["id", "is_group"])
    .where("id", "in", group)
    .orderBy("id")
    .forUpdate()
    .execute();
  if (members.some((member) => member.is_group)) {
    throw new SuppressionTargetError("Groups cannot be suppressed");
  }

  // An expired row still occupies the active-unique slot until it is closed.
  await trx
    .updateTable("contact_suppressions")
    .set({ revoked_at: now, revoked_by: SYSTEM_SUPPRESSION_ACTOR })
    .where("contact_id", "in", group)
    .where("scope", "=", input.scope)
    .where("revoked_at", "is", null)
    .where("expires_at", "<=", now)
    .execute();

  const existing = await trx
    .selectFrom("contact_suppressions")
    .select("id")
    .where("contact_id", "in", group)
    .where("scope", "=", input.scope)
    .where("revoked_at", "is", null)
    .orderBy("created_at")
    .executeTakeFirst();
  if (existing) return { suppressionId: existing.id, created: false };

  const inserted = await trx
    .insertInto("contact_suppressions")
    .values({
      contact_id: survivorId,
      scope: input.scope,
      reason,
      created_by: input.actorUserId,
      expires_at: input.expiresAt ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { suppressionId: inserted.id, created: true };
}

/**
 * Lift a suppression scope from a customer: every active row of that scope in
 * the merge group, because a merged customer blocked through either half must
 * be unblocked as a whole. Returns the number of rows revoked.
 */
export async function revokeSuppression(
  trx: Transaction<TenantDatabase>,
  input: {
    contactId: string;
    scope: ContactSuppressionScope;
    actorUserId: string;
    now?: Date;
  },
): Promise<number> {
  const group = await contactMergeGroup(trx, input.contactId);
  if (group.length === 0) return 0;
  await trx
    .selectFrom("contacts")
    .select("id")
    .where("id", "in", group)
    .orderBy("id")
    .forUpdate()
    .execute();
  const revoked = await trx
    .updateTable("contact_suppressions")
    .set({
      revoked_at: input.now ?? new Date(),
      revoked_by: input.actorUserId,
    })
    .where("contact_id", "in", group)
    .where("scope", "=", input.scope)
    .where("revoked_at", "is", null)
    .returning("id")
    .execute();
  return revoked.length;
}
