import type { Transaction } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";

/**
 * Fence a worker write against archive/relink/purge lifecycle changes.
 *
 * Archive and purge take FOR UPDATE on the same row. Holding KEY SHARE through
 * the event's writes means either the event commits first and purge removes it,
 * or archive/purge wins and this returns false. No event can commit orphaned
 * connection-owned rows after permanent deletion.
 */
export async function lockActiveConnectionForEvent(
  trx: Transaction<TenantDatabase>,
  connectionId: string,
): Promise<boolean> {
  const connection = await trx
    .selectFrom("whatsapp_connections")
    .select(["id", "archived_at"])
    .where("id", "=", connectionId)
    .forKeyShare()
    .executeTakeFirst();
  return Boolean(connection && !connection.archived_at);
}
