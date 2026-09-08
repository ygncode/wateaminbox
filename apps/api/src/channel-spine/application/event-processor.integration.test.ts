import { expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import type { NormalizedChannelEvent } from "@wateaminbox/shared";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";
import {
  applyNormalizedChannelEvent,
  ChannelEventIdentityCollisionError,
} from "./event-processor.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "applies a normalized message exactly once and quarantines identity reuse",
  async () => {
    const companyId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Channel event test",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      const tenantDb = await getTenantConnection(companyId);
      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: accountId,
          channel: "telegram",
          provider: "telegram_bot",
          display_name: "Test bot",
          external_account_id: "bot-1",
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
      const event = messageEvent(companyId, accountId, "hello");
      expect((await applyNormalizedChannelEvent(tenantDb, event)).outcome).toBe(
        "applied",
      );
      expect((await applyNormalizedChannelEvent(tenantDb, event)).outcome).toBe(
        "duplicate",
      );
      expect(
        Number(
          (
            await tenantDb
              .selectFrom("messages")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .executeTakeFirstOrThrow()
          ).count,
        ),
      ).toBe(1);

      const conflicting = messageEvent(companyId, accountId, "changed");
      await expect(
        applyNormalizedChannelEvent(tenantDb, conflicting),
      ).rejects.toBeInstanceOf(ChannelEventIdentityCollisionError);
      expect(
        (
          await tenantDb
            .selectFrom("channel_event_inbox")
            .select("status")
            .where("external_event_id", "=", "update-1")
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe("quarantined");
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
);

function messageEvent(
  companyId: string,
  channelAccountId: string,
  textContent: string,
): Extract<NormalizedChannelEvent, { kind: "message.upsert" }> {
  return {
    contractVersion: 1,
    eventId: "update-1",
    companyId,
    channelAccountId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "message.upsert",
    providerOccurredAt: "2026-09-08T12:00:00.000Z",
    receivedAt: "2026-09-08T12:00:01.000Z",
    payload: {
      conversation: {
        externalThreadId: "chat-10",
        clientThreadKey: "telegram:chat-10:root",
        kind: "direct",
      },
      externalMessageId: "message-20",
      externalIdentityScope: "telegram:chat-10",
      direction: "inbound",
      sender: {
        externalId: "user-30",
        identityScope: "telegram:user",
        endpointKind: "person",
        displayName: "Ada",
      },
      normalizedType: "text",
      textContent,
    },
  };
}
