import { type Kysely, sql } from "kysely";

/** Also installed for new tenants; the trigger covers older API writers. */
export async function installOutboxDispatchTrigger<DB>(
  db: Kysely<DB>,
  schema: string,
) {
  if (
    !/^tenant_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/.test(
      schema,
    )
  )
    throw new Error("Invalid tenant schema");
  const existing = await sql<{ present: boolean }>`SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = ${`${schema}.nats_outbox`}::regclass
      AND tgname = 'outbox_dispatch_ready' AND NOT tgisinternal
  ) AS present`.execute(db);
  if (!existing.rows[0]?.present) {
    await sql`CREATE TRIGGER outbox_dispatch_ready
      AFTER INSERT OR UPDATE OR DELETE ON ${sql.table(`${schema}.nats_outbox`)}
      FOR EACH ROW EXECUTE FUNCTION public.mark_outbox_dispatch_ready()`.execute(
      db,
    );
  }
}
