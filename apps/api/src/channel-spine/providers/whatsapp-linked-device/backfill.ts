import type { TenantDatabase } from "@wateaminbox/database";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  ensureLinkedDeviceAccount,
  ensureLinkedDeviceBridge,
  journalLinkedDeviceShadowFailure,
  shadowLinkedDeviceMessage,
  shadowLinkedDeviceWorkflow,
} from "./shadow";

export interface LinkedDeviceBackfillResult {
  accountsProcessed: number;
  contactsProcessed: number;
  messagesProcessed: number;
  workflowsProcessed: number;
  blockedRows: number;
}

/**
 * Run an idempotent, bounded full sweep. Checkpoints advance only after each
 * batch commits; a later invocation starts from the last committed cursor.
 */
export async function backfillLinkedDeviceTenant(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  batchSize = 250,
): Promise<LinkedDeviceBackfillResult> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 2_000) {
    throw new Error(
      "channel spine backfill batch size must be between 1 and 2000",
    );
  }
  const result: LinkedDeviceBackfillResult = {
    accountsProcessed: 0,
    contactsProcessed: 0,
    messagesProcessed: 0,
    workflowsProcessed: 0,
    blockedRows: 0,
  };

  await runCheckpointedPhase(
    tenantDb,
    "linked-device-accounts-v1",
    batchSize,
    async (cursor, limit) =>
      tenantDb
        .selectFrom("whatsapp_connections")
        .select("id")
        .$if(cursor !== null, (query) => query.where("id", ">", cursor!))
        .orderBy("id")
        .limit(limit)
        .execute(),
    async (trx, id) => {
      if (await ensureLinkedDeviceAccount(trx, id))
        result.accountsProcessed += 1;
      else {
        await journalLinkedDeviceShadowFailure(
          trx,
          "graph",
          "whatsapp_connections",
          id,
          "legacy_connection_missing",
        );
        result.blockedRows += 1;
      }
    },
  );

  await runCheckpointedPhase(
    tenantDb,
    "linked-device-contacts-v1",
    batchSize,
    async (cursor, limit) =>
      tenantDb
        .selectFrom("contacts")
        .select("id")
        .$if(cursor !== null, (query) => query.where("id", ">", cursor!))
        .orderBy("id")
        .limit(limit)
        .execute(),
    async (trx, id) => {
      const bridge = await ensureLinkedDeviceBridge(trx, id);
      if (bridge.status === "ready") result.contactsProcessed += 1;
      else {
        await journalLinkedDeviceShadowFailure(
          trx,
          "graph",
          "contacts",
          id,
          bridge.errorCode,
        );
        result.blockedRows += 1;
      }
    },
  );

  await runCheckpointedPhase(
    tenantDb,
    "linked-device-messages-v1",
    batchSize,
    async (cursor, limit) =>
      tenantDb
        .selectFrom("messages")
        .select("id")
        .$if(cursor !== null, (query) => query.where("id", ">", cursor!))
        .orderBy("id")
        .limit(limit)
        .execute(),
    async (trx, id) => {
      const bridge = await shadowLinkedDeviceMessage(trx, id);
      if (bridge.status === "ready") result.messagesProcessed += 1;
      else {
        await journalLinkedDeviceShadowFailure(
          trx,
          "message",
          "messages",
          id,
          bridge.errorCode,
        );
        result.blockedRows += 1;
      }
    },
  );

  await runCheckpointedPhase(
    tenantDb,
    "linked-device-workflows-v1",
    batchSize,
    async (cursor, limit) =>
      tenantDb
        .selectFrom("contacts")
        .select("id")
        .$if(cursor !== null, (query) => query.where("id", ">", cursor!))
        .orderBy("id")
        .limit(limit)
        .execute(),
    async (trx, id) => {
      const bridge = await shadowLinkedDeviceWorkflow(trx, companyId, id);
      if (bridge.status === "ready") result.workflowsProcessed += 1;
      else {
        await journalLinkedDeviceShadowFailure(
          trx,
          "workflow",
          "contacts",
          id,
          bridge.errorCode,
        );
        result.blockedRows += 1;
      }
    },
  );

  await repairNoGapRows(tenantDb, companyId, batchSize, result);
  return result;
}

async function runCheckpointedPhase(
  tenantDb: Kysely<TenantDatabase>,
  jobKey: string,
  batchSize: number,
  load: (
    cursor: string | null,
    limit: number,
  ) => Promise<Array<{ id: string }>>,
  apply: (trx: Transaction<TenantDatabase>, id: string) => Promise<void>,
): Promise<void> {
  const checkpoint = await tenantDb
    .selectFrom("channel_spine_backfill_checkpoints")
    .select(["cursor", "status"])
    .where("job_key", "=", jobKey)
    .executeTakeFirst();
  if (checkpoint?.status === "complete") return;
  let cursor = readCursor(checkpoint?.cursor);

  for (;;) {
    const rows = await load(cursor, batchSize);
    if (rows.length === 0) {
      await writeCheckpoint(tenantDb, jobKey, cursor, "complete");
      return;
    }
    await tenantDb.transaction().execute(async (trx) => {
      for (const row of rows) await apply(trx, row.id);
      cursor = rows.at(-1)!.id;
      await writeCheckpoint(trx, jobKey, cursor, "running", rows.length);
    });
  }
}

async function repairNoGapRows(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  batchSize: number,
  result: LinkedDeviceBackfillResult,
): Promise<void> {
  for (;;) {
    const accounts = await tenantDb
      .selectFrom("whatsapp_connections")
      .leftJoin(
        "channel_accounts",
        "channel_accounts.legacy_whatsapp_connection_id",
        "whatsapp_connections.id",
      )
      .select("whatsapp_connections.id")
      .where("channel_accounts.id", "is", null)
      .orderBy("whatsapp_connections.id")
      .limit(batchSize)
      .execute();
    if (accounts.length === 0) break;
    await tenantDb.transaction().execute(async (trx) => {
      for (const { id } of accounts) {
        if (await ensureLinkedDeviceAccount(trx, id)) {
          result.accountsProcessed += 1;
        } else {
          await journalLinkedDeviceShadowFailure(
            trx,
            "graph",
            "whatsapp_connections",
            id,
            "legacy_connection_missing",
          );
          result.blockedRows += 1;
        }
      }
    });
  }

  for (;;) {
    const contacts = await tenantDb
      .selectFrom("contacts")
      .leftJoin(
        "conversations",
        "conversations.legacy_contact_id",
        "contacts.id",
      )
      .leftJoin("contact_endpoints", (join) =>
        join
          .onRef(
            "contact_endpoints.channel_account_id",
            "=",
            "contacts.whatsapp_connection_id",
          )
          .onRef("contact_endpoints.external_id", "=", "contacts.jid")
          .on("contact_endpoints.provider", "=", "whatsapp_linked_device"),
      )
      .select("contacts.id")
      .where((expression) =>
        expression.or([
          expression("conversations.id", "is", null),
          expression("contact_endpoints.id", "is", null),
        ]),
      )
      .orderBy("contacts.id")
      .limit(batchSize)
      .execute();
    if (contacts.length === 0) break;
    let repaired = 0;
    await tenantDb.transaction().execute(async (trx) => {
      for (const { id } of contacts) {
        const bridge = await ensureLinkedDeviceBridge(trx, id);
        if (bridge.status === "ready") {
          repaired += 1;
          result.contactsProcessed += 1;
        } else {
          await journalLinkedDeviceShadowFailure(
            trx,
            "graph",
            "contacts",
            id,
            bridge.errorCode,
          );
        }
      }
    });
    if (repaired === 0) {
      result.blockedRows += contacts.length;
      break;
    }
  }

  for (;;) {
    const messages = await tenantDb
      .selectFrom("messages")
      .select("id")
      .where("contact_id", "is not", null)
      .where((expression) =>
        expression.or([
          expression("conversation_id", "is", null),
          expression("channel_account_id", "is", null),
        ]),
      )
      .orderBy("id")
      .limit(batchSize)
      .execute();
    if (messages.length === 0) break;
    let repaired = 0;
    await tenantDb.transaction().execute(async (trx) => {
      for (const { id } of messages) {
        const bridge = await shadowLinkedDeviceMessage(trx, id);
        if (bridge.status === "ready") {
          repaired += 1;
          result.messagesProcessed += 1;
        } else {
          await journalLinkedDeviceShadowFailure(
            trx,
            "message",
            "messages",
            id,
            bridge.errorCode,
          );
        }
      }
    });
    if (repaired === 0) {
      result.blockedRows += messages.length;
      break;
    }
  }

  const workflowContacts = await tenantDb
    .selectFrom("contacts")
    .leftJoin("conversations", "conversations.legacy_contact_id", "contacts.id")
    .select("contacts.id")
    .where("contacts.whatsapp_connection_id", "is not", null)
    .where("contacts.jid", "is not", null)
    .where("conversations.id", "is not", null)
    .orderBy("contacts.id")
    .execute();
  for (let index = 0; index < workflowContacts.length; index += batchSize) {
    const batch = workflowContacts.slice(index, index + batchSize);
    await tenantDb.transaction().execute(async (trx) => {
      for (const { id } of batch) {
        await shadowLinkedDeviceWorkflow(trx, companyId, id);
      }
    });
  }
}

function readCursor(
  cursor: Record<string, unknown> | undefined,
): string | null {
  return typeof cursor?.lastId === "string" ? cursor.lastId : null;
}

async function writeCheckpoint(
  database: Kysely<TenantDatabase>,
  jobKey: string,
  cursor: string | null,
  status: "running" | "complete",
  rowsProcessed = 0,
): Promise<void> {
  const now = new Date();
  await database
    .insertInto("channel_spine_backfill_checkpoints")
    .values({
      job_key: jobKey,
      phase: "linked-device-backfill",
      cursor: cursor ? { lastId: cursor } : {},
      rows_processed: String(rowsProcessed),
      status,
      started_at: now,
      completed_at: status === "complete" ? now : null,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict.column("job_key").doUpdateSet({
        cursor: cursor ? { lastId: cursor } : {},
        rows_processed: sql<string>`channel_spine_backfill_checkpoints.rows_processed + ${rowsProcessed}`,
        status,
        completed_at: status === "complete" ? now : null,
        updated_at: now,
      }),
    )
    .execute();
}
