import { describe, expect, test } from "bun:test";
import { db, type TenantDatabase } from "@wateaminbox/database";
import type { NormalizedChannelEvent } from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import { ContactBlockedError } from "../../lib/errors.js";
import { requireSendAccess } from "../../services/send-access.service.js";
import { applySuppression } from "./contact-policy.js";
import { applyNormalizedChannelEvent } from "./event-processor.js";
import {
  createSpineTestTenant,
  type SpineTestTenant,
} from "./spine-test-tenant.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

function inbound(
  tenant: SpineTestTenant,
  input: {
    updateId: number;
    text: string;
    chat?: string;
    kind?: "direct" | "group";
  },
): Extract<NormalizedChannelEvent, { kind: "message.upsert" }> {
  const chat = input.chat ?? "chat-1";
  return {
    contractVersion: 1,
    eventId: `update-${input.updateId}`,
    companyId: tenant.companyId,
    channelAccountId: tenant.accountId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "message.upsert",
    providerOccurredAt: new Date(
      Date.UTC(2026, 10, 20, 10, 0, input.updateId),
    ).toISOString(),
    receivedAt: "2026-11-20T10:05:00.000Z",
    payload: {
      conversation: {
        externalThreadId: chat,
        clientThreadKey: `telegram:${chat}:root`,
        kind: input.kind ?? "direct",
      },
      externalMessageId: `m-${input.updateId}`,
      externalIdentityScope: `telegram:${chat}`,
      direction: "inbound",
      sender: {
        externalId: "user-666",
        identityScope: "telegram:user",
        endpointKind: "person",
        displayName: "Spammer",
      },
      normalizedType: "text",
      textContent: input.text,
    },
  };
}

async function enforce(tenantDb: Kysely<TenantDatabase>, on: boolean) {
  await tenantDb
    .insertInto("contact_policy_settings")
    .values({ id: 1, enforcement_enabled: on })
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet({ enforcement_enabled: on }),
    )
    .execute();
}

async function count(
  tenantDb: Kysely<TenantDatabase>,
  table: "messages",
): Promise<number> {
  return Number(
    (
      await tenantDb
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow()
    ).n,
  );
}

async function pushJobs(companyId: string, kind: "push" | "realtime") {
  const rows = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM public.channel_message_delivery_outbox
    WHERE company_id = ${companyId}::uuid AND kind = ${kind}`.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

async function block(
  tenant: SpineTestTenant,
  scope: "block" | "mute_inbound",
): Promise<string> {
  const customer = await tenant.tenantDb
    .selectFrom("contacts")
    .select("id")
    .where("push_name", "=", "Spammer")
    .executeTakeFirstOrThrow();
  await tenant.tenantDb.transaction().execute((trx) =>
    applySuppression(trx, {
      contactId: customer.id,
      scope,
      reason: "manual",
      actorUserId: tenant.ownerId,
    }),
  );
  return customer.id;
}

async function cleanOutbox(companyId: string) {
  await sql`DELETE FROM public.channel_message_delivery_outbox
    WHERE company_id = ${companyId}::uuid`.execute(db);
}

describe("customer suppression enforcement on neutral ingress", () => {
  integration(
    "a blocked Telegram sender's new messages are dropped, counted, and stay dropped on replay",
    async () => {
      const tenant = await createSpineTestTenant("enforce-drop");
      try {
        const { tenantDb } = tenant;
        await enforce(tenantDb, true);
        await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 1, text: "first" }),
        );
        const customerId = await block(tenant, "block");
        const before = await count(tenantDb, "messages");
        const state = await tenantDb
          .selectFrom("conversation_states")
          .select("unread_count")
          .executeTakeFirstOrThrow();

        const spam = inbound(tenant, { updateId: 2, text: "spam" });
        const result = await applyNormalizedChannelEvent(tenantDb, spam);
        expect(result.outcome).toBe("applied");
        expect(result.suppressed).toBe(true);
        expect(await count(tenantDb, "messages")).toBe(before);
        expect(
          (
            await tenantDb
              .selectFrom("conversation_states")
              .select("unread_count")
              .executeTakeFirstOrThrow()
          ).unread_count,
        ).toBe(state.unread_count);

        // A provider retry is a duplicate, and does not count twice.
        expect(
          (await applyNormalizedChannelEvent(tenantDb, spam)).outcome,
        ).toBe("duplicate");
        await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 3, text: "more spam" }),
        );
        const drops = await tenantDb
          .selectFrom("contact_suppression_drops")
          .select(["contact_id", "channel", "dropped_count"])
          .execute();
        expect(drops).toEqual([
          { contact_id: customerId, channel: "telegram", dropped_count: 2 },
        ]);
        // No content of a dropped message is kept anywhere it could be read.
        const inbox = await tenantDb
          .selectFrom("channel_event_inbox")
          .select(["status"])
          .where("external_event_id", "=", "update-2")
          .executeTakeFirstOrThrow();
        expect(inbox.status).toBe("applied");
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );

  integration(
    "a muted sender's message is stored quietly: no unread, no push, still realtime",
    async () => {
      const tenant = await createSpineTestTenant("enforce-mute");
      try {
        const { tenantDb, companyId } = tenant;
        await enforce(tenantDb, true);
        await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 1, text: "first" }),
        );
        await block(tenant, "mute_inbound");
        await cleanOutbox(companyId);
        const unreadBefore = (
          await tenantDb
            .selectFrom("conversation_states")
            .select("unread_count")
            .executeTakeFirstOrThrow()
        ).unread_count;

        const result = await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 2, text: "noisy" }),
        );
        expect(result.suppressed).toBeUndefined();
        expect(result.messageId).toBeTruthy();
        expect(
          (
            await tenantDb
              .selectFrom("conversation_states")
              .select("unread_count")
              .executeTakeFirstOrThrow()
          ).unread_count,
        ).toBe(unreadBefore);
        expect(await pushJobs(companyId, "push")).toBe(0);
        expect(await pushJobs(companyId, "realtime")).toBe(1);
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );

  integration(
    "with enforcement off, a blocked sender is still stored exactly as before",
    async () => {
      const tenant = await createSpineTestTenant("enforce-off");
      try {
        const { tenantDb } = tenant;
        await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 1, text: "first" }),
        );
        await block(tenant, "block");
        const result = await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 2, text: "still stored" }),
        );
        expect(result.suppressed).toBeUndefined();
        expect(await count(tenantDb, "messages")).toBe(2);
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );

  integration(
    "a person block never drops their messages in a group",
    async () => {
      const tenant = await createSpineTestTenant("enforce-group");
      try {
        const { tenantDb } = tenant;
        await enforce(tenantDb, true);
        await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 1, text: "direct" }),
        );
        await block(tenant, "block");
        const group = await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, {
            updateId: 2,
            text: "in the group",
            chat: "group-9",
            kind: "group",
          }),
        );
        expect(group.suppressed).toBeUndefined();
        expect(group.messageId).toBeTruthy();
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );

  integration(
    "sending to a customer blocked through Telegram is refused, also on their WhatsApp half",
    async () => {
      const tenant = await createSpineTestTenant("enforce-outbound");
      try {
        const { tenantDb, ownerId } = tenant;
        await enforce(tenantDb, true);
        await applyNormalizedChannelEvent(
          tenantDb,
          inbound(tenant, { updateId: 1, text: "hello" }),
        );
        const telegramCustomer = await block(tenant, "block");
        const whatsappHalf = (
          await tenantDb
            .insertInto("contacts")
            .values({
              whatsapp_connection_id: null,
              jid: null,
              phone_number: null,
              push_name: "Spammer (WhatsApp)",
              record_kind: "customer",
              merged_into_contact_id: telegramCustomer,
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
        for (const contactId of [telegramCustomer, whatsappHalf]) {
          await expect(
            tenantDb
              .transaction()
              .execute((trx) => requireSendAccess(trx, contactId, ownerId)),
          ).rejects.toBeInstanceOf(ContactBlockedError);
        }
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );
});
