import { describe, expect, test } from "bun:test";
import { db, type TenantDatabase } from "@wateaminbox/database";
import type { NormalizedChannelEvent } from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import { activeSuppressions } from "./contact-policy.js";
import { applyNormalizedChannelEvent } from "./event-processor.js";
import {
  FLOOD_LIMITS,
  FLOOD_REASON,
  recordInboundForFlood,
} from "./inbound-flood.js";
import {
  createSpineTestTenant,
  type SpineTestTenant,
} from "./spine-test-tenant.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const BASE = Date.UTC(2026, 10, 21, 3, 0, 0);

function message(
  tenant: SpineTestTenant,
  n: number,
  sender = "flooder",
  at = BASE + n * 100,
): Extract<NormalizedChannelEvent, { kind: "message.upsert" }> {
  return {
    contractVersion: 1,
    eventId: `${sender}-${n}`,
    companyId: tenant.companyId,
    channelAccountId: tenant.accountId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "message.upsert",
    providerOccurredAt: new Date(at).toISOString(),
    receivedAt: new Date(at).toISOString(),
    payload: {
      conversation: {
        externalThreadId: `chat-${sender}`,
        clientThreadKey: `telegram:chat-${sender}:root`,
        kind: "direct",
      },
      externalMessageId: `${sender}-m-${n}`,
      externalIdentityScope: `telegram:chat-${sender}`,
      direction: "inbound",
      sender: {
        externalId: sender,
        identityScope: "telegram:user",
        endpointKind: "person",
        displayName: sender,
      },
      normalizedType: "text",
      textContent: `message ${n}`,
    },
  };
}

async function enforce(tenantDb: Kysely<TenantDatabase>, on = true) {
  await tenantDb
    .insertInto("contact_policy_settings")
    .values({ id: 1, enforcement_enabled: on })
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet({ enforcement_enabled: on }),
    )
    .execute();
}

async function unread(tenantDb: Kysely<TenantDatabase>, name: string) {
  return (
    await tenantDb
      .selectFrom("conversation_states")
      .innerJoin("contacts", "contacts.id", "conversation_states.contact_id")
      .select("conversation_states.unread_count")
      .where("contacts.push_name", "=", name)
      .executeTakeFirstOrThrow()
  ).unread_count;
}

async function cleanOutbox(companyId: string) {
  await sql`DELETE FROM public.channel_message_delivery_outbox
    WHERE company_id = ${companyId}::uuid`.execute(db);
}

describe("inbound flood limits", () => {
  integration(
    "the 31st message in a minute arrives quietly and starts a 10-minute auto mute; other senders are untouched",
    async () => {
      const tenant = await createSpineTestTenant("flood-chat");
      try {
        const { tenantDb } = tenant;
        await enforce(tenantDb);
        const limit = FLOOD_LIMITS.chat.perMinute;
        for (let n = 1; n <= limit; n++) {
          await applyNormalizedChannelEvent(tenantDb, message(tenant, n));
        }
        expect(await unread(tenantDb, "flooder")).toBe(limit);

        const over = await applyNormalizedChannelEvent(
          tenantDb,
          message(tenant, limit + 1),
        );
        // Still stored - nothing is lost - but quiet.
        expect(over.messageId).toBeTruthy();
        expect(await unread(tenantDb, "flooder")).toBe(limit);

        const flooder = await tenantDb
          .selectFrom("contacts")
          .select("id")
          .where("push_name", "=", "flooder")
          .executeTakeFirstOrThrow();
        const mutes = await activeSuppressions(
          tenantDb,
          flooder.id,
          new Date(BASE + 60_000),
        );
        expect(mutes).toHaveLength(1);
        expect(mutes[0]!.scope).toBe("mute_inbound");
        expect(mutes[0]!.reason).toBe(FLOOD_REASON);
        expect(mutes[0]!.expiresAt!.getTime()).toBe(
          BASE + (limit + 1) * 100 + 10 * 60_000,
        );
        // The auto mute is never a block.
        expect(
          (await activeSuppressions(tenantDb, flooder.id, new Date(BASE))).some(
            (row) => row.scope === "block",
          ),
        ).toBe(false);

        // Someone else on the same bot is unaffected.
        await applyNormalizedChannelEvent(
          tenantDb,
          message(tenant, 1, "polite"),
        );
        expect(await unread(tenantDb, "polite")).toBe(1);

        // After the quiet period the flooder's messages count again.
        const later = BASE + 11 * 60_000;
        await applyNormalizedChannelEvent(
          tenantDb,
          message(tenant, 500, "flooder", later),
        );
        expect(await unread(tenantDb, "flooder")).toBe(limit + 1);
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );

  integration(
    "a provider retry does not count twice, and enforcement switched off means no counting at all",
    async () => {
      const tenant = await createSpineTestTenant("flood-retry");
      try {
        const { tenantDb } = tenant;
        await enforce(tenantDb, false);
        const event = message(tenant, 1);
        await applyNormalizedChannelEvent(tenantDb, event);
        expect(
          await tenantDb
            .selectFrom("inbound_flood_windows")
            .selectAll()
            .execute(),
        ).toEqual([]);

        await enforce(tenantDb);
        const second = message(tenant, 2);
        await applyNormalizedChannelEvent(tenantDb, second);
        await applyNormalizedChannelEvent(tenantDb, second);
        const windows = await tenantDb
          .selectFrom("inbound_flood_windows")
          .select("message_count")
          .execute();
        expect(windows).toEqual([{ message_count: 1 }]);
      } finally {
        await cleanOutbox(tenant.companyId);
        await tenant.drop();
      }
    },
  );

  integration(
    "email uses its own lower limit, and the optional auto-mute extends the quiet period",
    async () => {
      const tenant = await createSpineTestTenant("flood-email");
      try {
        const { tenantDb } = tenant;
        const contact = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: null,
            jid: null,
            phone_number: null,
            push_name: "mail loop",
            record_kind: "customer",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const email = FLOOD_LIMITS.email;
        let verdict = { silence: false, startedQuietPeriod: false };
        for (let n = 1; n <= email.perMinute + 1; n++) {
          verdict = await tenantDb.transaction().execute((trx) =>
            recordInboundForFlood(trx, {
              contactId: contact.id,
              channel: "email",
              volumeClass: "email",
              at: new Date(BASE + n * 1000),
            }),
          );
        }
        expect(verdict).toEqual({ silence: true, startedQuietPeriod: true });
        const mute = (
          await activeSuppressions(tenantDb, contact.id, new Date(BASE))
        )[0]!;
        expect(mute.expiresAt!.getTime()).toBe(
          BASE + (email.perMinute + 1) * 1000 + email.quietMinutes * 60_000,
        );

        // With auto-mute switched on, a sustained flood earns the longer mute.
        const strict = {
          ...FLOOD_LIMITS.chat,
          perMinute: 2,
          autoMute: {
            enabled: true,
            messages: 5,
            windowMinutes: 10,
            muteMinutes: 60,
          },
        };
        const chatty = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: null,
            jid: null,
            phone_number: null,
            push_name: "chatty",
            record_kind: "customer",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        for (let n = 0; n < 5; n++) {
          await tenantDb.transaction().execute((trx) =>
            recordInboundForFlood(trx, {
              contactId: chatty.id,
              channel: "telegram",
              volumeClass: "chat",
              at: new Date(BASE + n * 1000),
              limits: strict,
            }),
          );
        }
        const long = (
          await activeSuppressions(tenantDb, chatty.id, new Date(BASE))
        )[0]!;
        expect(long.expiresAt!.getTime()).toBe(BASE + 4000 + 60 * 60_000);
      } finally {
        await tenant.drop();
      }
    },
  );
});
