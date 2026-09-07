import { type Kysely, sql } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

/** Persist independently of mail; dismissing a notification must not recreate it on a mail retry. */
export async function persistConnectionSystemNotification(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  alertId: string,
  connectionName: string,
): Promise<{ id: string; created: boolean } | null> {
  return tenantDb.transaction().execute(async (trx) => {
    const alert = await trx
      .selectFrom("connection_email_alerts")
      .selectAll()
      .where("id", "=", alertId)
      .forUpdate()
      .executeTakeFirst();
    // A recovery or archive may have canceled the alert after it was claimed.
    if (!alert) return null;
    if (alert.notification_created_at) return { id: alert.id, created: false };
    const loggedOut = alert.kind === "logged_out";
    await trx
      .insertInto("notification_history")
      .values({
        id: alert.id,
        user_id: alert.user_id,
        notification_type: "system",
        title: loggedOut
          ? "WhatsApp logged out"
          : "WhatsApp connection offline",
        message: loggedOut
          ? `“${connectionName}” was unlinked from WhatsApp. Open Connections and scan a new QR code to reconnect.`
          : `“${connectionName}” has been offline for at least five minutes. Open Connections to check its current status and reconnect if needed.`,
        action_url: `/w/${encodeURIComponent(companyId)}/settings/connections`,
        metadata: {
          connectionId: alert.connection_id,
          connectionAlertKind: alert.kind,
        },
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .updateTable("connection_email_alerts")
      .set({ notification_created_at: sql<Date>`now()` })
      .where("id", "=", alert.id)
      .execute();
    return { id: alert.id, created: true };
  });
}
