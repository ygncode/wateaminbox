import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";

type MergeDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/**
 * Follow `merged_into_contact_id` to the surviving contact.
 *
 * Contact-profile reads may follow this alias. Conversation/workflow routes
 * must not: the RFC keeps an old chat URL pointing at its own conversation
 * even after its customer row was merged away.
 */
const MAX_MERGE_ALIAS_DEPTH = 8;

export async function resolveCanonicalContactId(
  db: MergeDb,
  contactId: string,
): Promise<string | null> {
  let current = contactId;
  for (let depth = 0; depth < MAX_MERGE_ALIAS_DEPTH; depth++) {
    const row = await db
      .selectFrom("contacts")
      .select(["id", "merged_into_contact_id"])
      .where("id", "=", current)
      .executeTakeFirst();
    if (!row) return null;
    if (!row.merged_into_contact_id) return row.id;
    current = row.merged_into_contact_id;
  }
  // A cycle or an unexpectedly deep chain must not resolve to a random row.
  return null;
}

export interface MergeResult {
  mergeEventId: string;
  movedEndpoints: number;
  sourceContactId: string;
  targetContactId: string;
}

export async function mergeContacts(
  tenantDb: Kysely<TenantDatabase>,
  input: {
    sourceContactId: string;
    targetContactId: string;
    actorUserId: string;
    reason: string;
  },
): Promise<MergeResult> {
  if (input.sourceContactId === input.targetContactId) {
    throw new ValidationError("A contact cannot be merged into itself");
  }
  return tenantDb.transaction().execute(async (trx) => {
    const [source, target] = await Promise.all([
      trx
        .selectFrom("contacts")
        .select(["id", "is_group", "merged_into_contact_id"])
        .where("id", "=", input.sourceContactId)
        .forUpdate()
        .executeTakeFirst(),
      trx
        .selectFrom("contacts")
        .select(["id", "is_group", "merged_into_contact_id"])
        .where("id", "=", input.targetContactId)
        .forUpdate()
        .executeTakeFirst(),
    ]);
    if (!source || !target) throw new NotFoundError("Contact");
    if (source.is_group || target.is_group) {
      throw new ValidationError("Group contacts cannot be merged");
    }
    if (source.merged_into_contact_id || target.merged_into_contact_id) {
      throw new ConflictError("One of the contacts has already been merged");
    }
    // Group, bot, shared-mailbox, and organization endpoints are shared
    // identities. Folding one into a person would silently reassign a whole
    // audience, so a merge touching one is refused rather than partially
    // applied.
    const sharedIdentity = await trx
      .selectFrom("contact_endpoints")
      .select(["endpoint_kind"])
      .where("contact_id", "in", [source.id, target.id])
      .execute();
    if (
      sharedIdentity.some(
        (endpoint) => !MERGEABLE_ENDPOINT_KINDS.has(endpoint.endpoint_kind),
      )
    ) {
      throw new ValidationError(
        "Contacts with a group, bot, or shared endpoint cannot be merged",
      );
    }

    const endpoints = await trx
      .selectFrom("contact_endpoints")
      .select(["id", "contact_id", "channel", "provider", "external_id"])
      .where("contact_id", "=", source.id)
      .execute();

    const mergeEvent = await trx
      .insertInto("contact_merge_events")
      .values({
        source_contact_id: source.id,
        target_contact_id: target.id,
        actor_user_id: input.actorUserId,
        reason: input.reason,
        // node-postgres renders a JS array as a Postgres array literal, so the
        // JSONB snapshot has to be serialized explicitly.
        endpoint_snapshot: sql<unknown[]>`${JSON.stringify(endpoints)}::jsonb`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const endpoint of endpoints) {
      await trx
        .updateTable("contact_endpoints")
        .set({ contact_id: target.id, updated_at: new Date() })
        .where("id", "=", endpoint.id)
        .execute();
      await trx
        .insertInto("contact_endpoint_reassignment_events")
        .values({
          merge_event_id: mergeEvent.id,
          contact_endpoint_id: endpoint.id,
          previous_contact_id: source.id,
          new_contact_id: target.id,
          actor_user_id: input.actorUserId,
          reason: input.reason,
        })
        .execute();
    }

    await trx
      .updateTable("contacts")
      .set({
        merged_into_contact_id: target.id,
        archived_at: new Date(),
        updated_at: new Date(),
      })
      .where("id", "=", source.id)
      .execute();

    return {
      mergeEventId: mergeEvent.id,
      movedEndpoints: endpoints.length,
      sourceContactId: source.id,
      targetContactId: target.id,
    };
  });
}

export interface UnmergeResult {
  mergeEventId: string;
  restoredEndpoints: number;
  skippedEndpoints: number;
  sourceContactId: string;
  targetContactId: string;
}

export interface UnmergeInput {
  mergeEventId: string;
  actorUserId: string;
  reason: string;
}

/**
 * Reverse one merge.
 *
 * The RFC gates enabling merges on there being a correction path, because a
 * merge is otherwise an irreversible answer to a guess about identity.
 *
 * This is a correction, not a rollback: it restores the endpoints this merge
 * actually moved and revives the source customer, and it deliberately leaves
 * every conversation, message, assignment, case, note, and tag exactly where
 * it is - the same asymmetry the merge itself observes, since none of them
 * ever moved.
 *
 * An endpoint is restored only when it is still where this merge left it. If
 * a later merge or a manual reassignment moved it on, reversing this one
 * would silently clobber that newer decision, so the endpoint is skipped and
 * reported instead.
 */
export async function unmergeContacts(
  tenantDb: Kysely<TenantDatabase>,
  input: UnmergeInput,
): Promise<UnmergeResult> {
  return tenantDb.transaction().execute(async (trx) => {
    const mergeEvent = await trx
      .selectFrom("contact_merge_events")
      .select(["id", "source_contact_id", "target_contact_id"])
      .where("id", "=", input.mergeEventId)
      .executeTakeFirst();
    if (!mergeEvent) {
      throw new ValidationError("No such merge event");
    }
    const source = await trx
      .selectFrom("contacts")
      .select(["id", "merged_into_contact_id"])
      .where("id", "=", mergeEvent.source_contact_id)
      .executeTakeFirst();
    if (!source) {
      throw new ValidationError("The merged-away contact no longer exists");
    }
    // Only the merge that is currently in effect can be corrected. If the
    // source was merged again afterwards, undoing this older event would
    // revive it into a state that no longer describes anything.
    if (source.merged_into_contact_id !== mergeEvent.target_contact_id) {
      throw new ValidationError(
        "This merge has already been superseded and cannot be reversed",
      );
    }

    const moved = await trx
      .selectFrom("contact_endpoint_reassignment_events")
      .select(["contact_endpoint_id", "previous_contact_id"])
      .where("merge_event_id", "=", mergeEvent.id)
      .execute();

    let restoredEndpoints = 0;
    let skippedEndpoints = 0;
    for (const record of moved) {
      const endpoint = await trx
        .selectFrom("contact_endpoints")
        .select(["id", "contact_id"])
        .where("id", "=", record.contact_endpoint_id)
        .forUpdate()
        .executeTakeFirst();
      // Still where this merge put it, or someone has since moved it on.
      if (!endpoint || endpoint.contact_id !== mergeEvent.target_contact_id) {
        skippedEndpoints++;
        continue;
      }
      await trx
        .updateTable("contact_endpoints")
        .set({
          contact_id: record.previous_contact_id,
          updated_at: new Date(),
        })
        .where("id", "=", endpoint.id)
        .execute();
      // The reversal is itself audited, and carries no merge_event_id: it
      // undoes a merge rather than belonging to one, and the original rows
      // stay untouched so the history reads forwards.
      await trx
        .insertInto("contact_endpoint_reassignment_events")
        .values({
          merge_event_id: null,
          contact_endpoint_id: endpoint.id,
          previous_contact_id: mergeEvent.target_contact_id,
          new_contact_id: record.previous_contact_id,
          actor_user_id: input.actorUserId,
          reason: input.reason,
        })
        .execute();
      restoredEndpoints++;
    }

    await trx
      .updateTable("contacts")
      .set({
        merged_into_contact_id: null,
        archived_at: null,
        updated_at: new Date(),
      })
      .where("id", "=", source.id)
      .execute();

    return {
      mergeEventId: mergeEvent.id,
      restoredEndpoints,
      skippedEndpoints,
      sourceContactId: mergeEvent.source_contact_id,
      targetContactId: mergeEvent.target_contact_id,
    };
  });
}

/**
 * Endpoint kinds a person merge may involve.
 *
 * An allowlist rather than a denylist: a future adapter that introduces a new
 * shared identity kind must be considered explicitly instead of inheriting
 * person-merge semantics by default. The RFC refuses group, bot,
 * shared-mailbox, and organization endpoints outright.
 */
const MERGEABLE_ENDPOINT_KINDS = new Set(["person", "user", "phone", "email"]);

export interface MergeSuggestion {
  contactId: string;
  /** The normalized phone/email both contacts were seen at. */
  matchedAddress: string;
  /** Channels the candidate's matching endpoints belong to. */
  channels: string[];
  /** True when every matching endpoint pair is on the same channel. */
  sameChannel: boolean;
  /**
   * True when the candidate's matching endpoint is provider- or user-verified.
   * Unverified evidence is a suggestion only and always needs a human decision.
   */
  verified: boolean;
}

/**
 * Candidate contacts that share a normalized address with `contactId`.
 *
 * Evidence only. Names, avatars, and usernames are deliberately not matched:
 * the RFC treats them as evidence, never as durable identity keys, and a
 * display-name collision is the most common way two different people would be
 * proposed as one. Nothing here executes a merge.
 */
export async function suggestContactMerges(
  db: MergeDb,
  contactId: string,
  limit = 20,
): Promise<MergeSuggestion[]> {
  const own = await db
    .selectFrom("contact_endpoints")
    .select(["normalized_address", "channel", "endpoint_kind"])
    .where("contact_id", "=", contactId)
    .where("normalized_address", "is not", null)
    .execute();
  const addresses = [
    ...new Set(
      own
        .filter((endpoint) =>
          MERGEABLE_ENDPOINT_KINDS.has(endpoint.endpoint_kind),
        )
        .map((endpoint) => endpoint.normalized_address as string),
    ),
  ];
  if (addresses.length === 0) return [];
  const ownChannels = new Set(own.map((endpoint) => endpoint.channel));

  const matches = await db
    .selectFrom("contact_endpoints as endpoint")
    .innerJoin("contacts as contact", "contact.id", "endpoint.contact_id")
    .select([
      "endpoint.contact_id",
      "endpoint.normalized_address",
      "endpoint.channel",
      "endpoint.endpoint_kind",
      "endpoint.verification_state",
    ])
    .where("endpoint.normalized_address", "in", addresses)
    .where("endpoint.contact_id", "is not", null)
    .where("endpoint.contact_id", "!=", contactId)
    .where("contact.is_group", "=", false)
    .where("contact.merged_into_contact_id", "is", null)
    .execute();

  const byContact = new Map<string, MergeSuggestion>();
  for (const match of matches) {
    if (!MERGEABLE_ENDPOINT_KINDS.has(match.endpoint_kind)) continue;
    const id = match.contact_id as string;
    const suggestion = byContact.get(id) ?? {
      contactId: id,
      matchedAddress: match.normalized_address as string,
      channels: [],
      sameChannel: true,
      verified: false,
    };
    if (!suggestion.channels.includes(match.channel)) {
      suggestion.channels.push(match.channel);
    }
    if (!ownChannels.has(match.channel)) suggestion.sameChannel = false;
    if (
      match.verification_state === "provider_verified" ||
      match.verification_state === "user_verified"
    ) {
      suggestion.verified = true;
    }
    byContact.set(id, suggestion);
  }
  return [...byContact.values()]
    .sort((a, b) => a.contactId.localeCompare(b.contactId))
    .slice(0, limit);
}
