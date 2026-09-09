import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";

type QuotaDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/**
 * How many of a workspace's paid connection slots are in use, on any channel.
 *
 * A connection is the unit the plan sells, and an inbox source is an inbox
 * source whether it is a linked WhatsApp device or a Telegram bot. Counting
 * only `whatsapp_connections` let a workspace add unlimited channel accounts
 * outside its plan, so the cap and the per-connection add-on applied to one
 * channel and not the others.
 *
 * A channel account that merely bridges an existing linked device is not
 * counted twice: those carry `legacy_whatsapp_connection_id`, and the
 * WhatsApp row they point at is already in the total.
 */
export async function countUsedConnectionSlots(db: QuotaDb): Promise<number> {
  const [whatsapp, channels] = await Promise.all([
    db
      .selectFrom("whatsapp_connections")
      .select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("status", "in", ["connected", "pending"])
      .executeTakeFirst(),
    db
      .selectFrom("channel_accounts")
      .select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("archived_at", "is", null)
      .where("legacy_whatsapp_connection_id", "is", null)
      // A failed or disabled account still occupies its slot until it is
      // archived, matching how a disconnected WhatsApp row keeps counting
      // while it is still pending or connected.
      .where("status", "!=", "archived")
      .executeTakeFirst(),
  ]);
  return Number(whatsapp?.count ?? 0) + Number(channels?.count ?? 0);
}
