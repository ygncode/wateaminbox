import type { TenantDatabase } from "@wateaminbox/database";
import { sql } from "kysely";
import type { Kysely, Transaction } from "kysely";
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
