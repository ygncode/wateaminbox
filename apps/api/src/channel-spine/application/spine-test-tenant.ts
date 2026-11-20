import {
  db,
  reconcileChannelSpineConcurrentIndexes,
  type TenantDatabase,
} from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

/**
 * A throwaway workspace with one connected Telegram bot account, for
 * integration tests of the channel spine. Always call `drop()` in `finally`.
 */
export interface SpineTestTenant {
  companyId: string;
  accountId: string;
  ownerId: string;
  tenantDb: Kysely<TenantDatabase>;
  drop(): Promise<void>;
}

export async function createSpineTestTenant(
  label: string,
): Promise<SpineTestTenant> {
  const companyId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const drop = async () => {
    clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("sla_policies")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  };
  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `${label}-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: label,
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: companyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
      })
      .execute();
    await createTenantSchema(companyId);
    await reconcileChannelSpineConcurrentIndexes(db, schemaName);
    const tenantDb = await getTenantConnection(companyId);
    await tenantDb
      .insertInto("channel_accounts")
      .values({
        id: accountId,
        channel: "telegram",
        provider: "telegram_bot",
        display_name: "Test bot",
        external_account_id: `bot-${accountId}`,
        external_scope_id: "telegram",
        status: "connected",
        provider_status: null,
        capabilities_revision: null,
        legacy_whatsapp_connection_id: null,
        connected_by: null,
        connected_at: new Date(),
        last_sync_at: null,
        archived_at: null,
      })
      .execute();
    return { companyId, accountId, ownerId, tenantDb, drop };
  } catch (error) {
    await drop();
    throw error;
  }
}
