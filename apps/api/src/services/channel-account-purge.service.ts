import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { NotFoundError } from "../lib/errors.js";

export class ChannelAccountNotArchivedError extends Error {
  constructor() {
    super("Archive the channel account before permanently purging it");
  }
}

export async function purgeArchivedChannelAccount(
  tenantDb: Kysely<TenantDatabase>,
  accountId: string,
): Promise<{ contactIds: string[]; deletedMessageCount: number }> {
  return tenantDb.transaction().execute(async (trx) => {
    const account = await trx
      .selectFrom("channel_accounts")
      .select(["id", "archived_at", "legacy_whatsapp_connection_id"])
      .where("id", "=", accountId)
      .forUpdate()
      .executeTakeFirst();
    if (!account) throw new NotFoundError("Channel account");
    if (!account.archived_at) throw new ChannelAccountNotArchivedError();
    if (account.legacy_whatsapp_connection_id) {
      throw new Error("Use the linked-device purge flow for this account");
    }

    const contacts = await trx
      .selectFrom("conversations")
      .select("legacy_contact_id")
      .where("channel_account_id", "=", accountId)
      .where("legacy_contact_id", "is not", null)
      .execute();
    const contactIds = [
      ...new Set(
        contacts
          .map((row) => row.legacy_contact_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    await trx
      .insertInto("purge_cleanup_items")
      .columns(["connection_id", "kind", "reference"])
      .expression((eb) =>
        eb
          .selectFrom("message_attachments as attachment")
          .innerJoin(
            "messages as message",
            "message.id",
            "attachment.message_id",
          )
          .select([
            sql<string>`${accountId}::uuid`.as("connection_id"),
            eb.val("media" as const).as("kind"),
            "attachment.storage_uri as reference",
          ])
          .distinct()
          .where("message.channel_account_id", "=", accountId)
          .where("attachment.storage_uri", "is not", null),
      )
      .onConflict((oc) =>
        oc.columns(["connection_id", "kind", "reference"]).doNothing(),
      )
      .execute();

    await trx
      .deleteFrom("outbound_message_intents")
      .where("channel_account_id", "=", accountId)
      .execute();
    await trx
      .deleteFrom("channel_event_inbox")
      .where("channel_account_id", "=", accountId)
      .execute();
    await trx
      .deleteFrom("contact_endpoint_reassignment_events")
      .where("contact_endpoint_id", "in", (eb) =>
        eb
          .selectFrom("contact_endpoints")
          .select("id")
          .where("channel_account_id", "=", accountId),
      )
      .execute();
    const conversations = trx
      .selectFrom("conversations")
      .select("id")
      .where("channel_account_id", "=", accountId);
    await trx
      .deleteFrom("conversation_cases")
      .where((eb) =>
        eb.or([
          eb("conversation_id", "in", conversations),
          contactIds.length > 0
            ? eb("contact_id", "in", contactIds)
            : eb.val(false),
        ]),
      )
      .execute();
    await trx
      .deleteFrom("conversation_states")
      .where((eb) =>
        eb.or([
          eb("conversation_id", "in", conversations),
          contactIds.length > 0
            ? eb("contact_id", "in", contactIds)
            : eb.val(false),
        ]),
      )
      .execute();
    await trx
      .deleteFrom("contact_assignments")
      .where((eb) =>
        eb.or([
          eb("conversation_id", "in", conversations),
          contactIds.length > 0
            ? eb("contact_id", "in", contactIds)
            : eb.val(false),
        ]),
      )
      .execute();
    const deletedMessages = await trx
      .deleteFrom("messages")
      .where("channel_account_id", "=", accountId)
      .executeTakeFirst();
    await sql`DELETE FROM public.channel_message_delivery_outbox
      WHERE channel_account_id = ${accountId}`.execute(trx);
    await sql`DELETE FROM public.channel_ingress_routes
      WHERE channel_account_id = ${accountId}`.execute(trx);
    await trx
      .deleteFrom("conversations")
      .where("channel_account_id", "=", accountId)
      .execute();
    await trx
      .deleteFrom("channel_accounts")
      .where("id", "=", accountId)
      .execute();
    if (contactIds.length > 0) {
      // Merge history describes these customers and its foreign keys are
      // RESTRICT, so leaving it behind pins the rows and fails the purge. The
      // records go with the customers they are about; an audit trail naming
      // rows that no longer exist is worse than none.
      await trx
        .deleteFrom("contact_endpoint_reassignment_events")
        .where((eb) =>
          eb.or([
            eb("previous_contact_id", "in", contactIds),
            eb("new_contact_id", "in", contactIds),
          ]),
        )
        .execute();
      await trx
        .deleteFrom("contact_merge_events")
        .where((eb) =>
          eb.or([
            eb("source_contact_id", "in", contactIds),
            eb("target_contact_id", "in", contactIds),
          ]),
        )
        .execute();
      await trx
        .updateTable("contacts")
        .set({ merged_into_contact_id: null, updated_at: new Date() })
        .where("merged_into_contact_id", "in", contactIds)
        .execute();
      await trx.deleteFrom("contacts").where("id", "in", contactIds).execute();
    }
    return {
      contactIds,
      deletedMessageCount: Number(deletedMessages?.numDeletedRows ?? 0n),
    };
  });
}
