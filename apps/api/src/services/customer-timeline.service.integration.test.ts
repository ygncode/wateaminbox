import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { mergeContacts } from "./contact-merge.service.js";
import {
  decodeTimelineCursor,
  listCustomerTimeline,
  resolveCustomerThreads,
  type TimelineCursor,
} from "./customer-timeline.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Fixture {
  companyId: string;
  ownerId: string;
  schemaName: string;
}

async function seed(name: string): Promise<Fixture> {
  const companyId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  await db
    .insertInto("users")
    .values({
      id: ownerId,
      email: `timeline-${ownerId}@example.com`,
      password_hash: "test",
    })
    .execute();
  await db
    .insertInto("companies")
    .values({ id: companyId, name, schema_name: schemaName, status: "active" })
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
      effective_from: new Date("1970-01-01T00:00:00Z"),
      created_by: ownerId,
    })
    .execute();
  await createTenantSchema(companyId);
  return { companyId, ownerId, schemaName };
}

async function teardown({ companyId, ownerId, schemaName }: Fixture) {
  clearTenantConnection(companyId);
  await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  await db
    .deleteFrom("sla_policies")
    .where("company_id", "=", companyId)
    .execute();
  await db.deleteFrom("companies").where("id", "=", companyId).execute();
  await db.deleteFrom("users").where("id", "=", ownerId).execute();
}

/**
 * The merged read.
 *
 * Every case here is one the merge-sort can get wrong in a way that looks like
 * a pagination bug rather than a wrong answer: a row on the wrong page, a row
 * on two pages, or a row on none.
 */
describe("listCustomerTimeline", () => {
  integrationTest(
    "interleaves two channels, paginates without gaps or repeats, and survives a tie",
    async () => {
      const fixture = await seed("Customer timeline test");
      const { companyId, ownerId } = fixture;
      try {
        const tenantDb = getTenantConnection(companyId);
        const whatsappAccount = crypto.randomUUID();
        const telegramAccount = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values([
            {
              id: whatsappAccount,
              channel: "whatsapp",
              provider: "whatsapp_linked_device",
              display_name: "Linked device",
              status: "connected",
            },
            {
              id: telegramAccount,
              channel: "telegram",
              provider: "telegram_bot",
              display_name: "Bot",
              status: "connected",
            },
          ])
          .execute();

        const target = await tenantDb
          .insertInto("contacts")
          .values({ jid: "60123456789@s.whatsapp.net", push_name: "Ada" })
          .returning("id")
          .executeTakeFirstOrThrow();
        const source = await tenantDb
          .insertInto("contacts")
          .values({ push_name: "Ada (Telegram)" })
          .returning("id")
          .executeTakeFirstOrThrow();

        const threads: Record<string, string> = {};
        for (const [contactId, account, channel] of [
          [target.id, whatsappAccount, "whatsapp"],
          [source.id, telegramAccount, "telegram"],
        ] as const) {
          const endpoint = await tenantDb
            .insertInto("contact_endpoints")
            .values({
              contact_id: contactId,
              channel,
              provider:
                channel === "whatsapp"
                  ? "whatsapp_linked_device"
                  : "telegram_bot",
              channel_account_id: account,
              endpoint_kind: "person",
              external_id: `${contactId}-endpoint`,
              identity_scope: "global",
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const conversation = await tenantDb
            .insertInto("conversations")
            .values({
              channel_account_id: account,
              client_thread_key: `${channel}:${crypto.randomUUID()}`,
              kind: "direct",
              legacy_contact_id: contactId,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await tenantDb
            .insertInto("conversation_participants")
            .values({
              conversation_id: conversation.id,
              contact_endpoint_id: endpoint.id,
              participant_kind: "external",
              role: "member",
            })
            .execute();
          threads[channel] = conversation.id;
        }

        // Alternating channels, plus two messages sharing a timestamp so a
        // page boundary can fall on the tie.
        const sent: string[] = [];
        for (let index = 0; index < 8; index++) {
          const channel = index % 2 === 0 ? "whatsapp" : "telegram";
          const id = crypto.randomUUID();
          sent.push(id);
          await tenantDb
            .insertInto("messages")
            .values({
              id,
              contact_id: channel === "whatsapp" ? target.id : source.id,
              conversation_id: threads[channel]!,
              channel_account_id:
                channel === "whatsapp" ? whatsappAccount : telegramAccount,
              from_me: false,
              message_type: "text",
              content: `message ${index}`,
              // Messages 4 and 5 share a timestamp.
              timestamp: new Date(
                Date.UTC(2026, 8, 8, 12, index === 5 ? 4 : index),
              ),
            })
            .execute();
        }

        await mergeContacts(tenantDb, {
          sourceContactId: source.id,
          targetContactId: target.id,
          actorUserId: ownerId,
          reason: "Same customer",
        });

        const resolved = await resolveCustomerThreads(
          tenantDb,
          companyId,
          target.id,
        );
        expect(resolved?.canonicalContactId).toBe(target.id);

        // Asking from the merged-away side answers for the same customer, so
        // an old chat URL reads the whole history.
        const fromSource = await resolveCustomerThreads(
          tenantDb,
          companyId,
          source.id,
        );
        expect(fromSource?.canonicalContactId).toBe(target.id);

        const all = await listCustomerTimeline(tenantDb, {
          threads: resolved!.threads,
          limit: 50,
        });
        expect(all.messages).toHaveLength(8);
        expect(all.hasMore).toBe(false);
        // Both channels really are interleaved, not concatenated.
        const channels = all.messages.map((message) =>
          message.conversation_id === threads.whatsapp ? "WA" : "TG",
        );
        expect(new Set(channels).size).toBe(2);
        expect(channels.slice(0, 2)).not.toEqual(["WA", "WA"]);

        // Walk it three at a time and rebuild the whole history.
        const walked: string[] = [];
        let cursor: TimelineCursor | undefined;
        for (let page = 0; page < 5; page++) {
          const result = await listCustomerTimeline(tenantDb, {
            threads: resolved!.threads,
            limit: 3,
            cursor,
          });
          walked.push(...result.messages.map((message) => message.id));
          if (!result.hasMore) break;
          cursor = decodeTimelineCursor(result.nextCursor!) ?? undefined;
        }
        expect(walked).toHaveLength(8);
        // No row on two pages, and none missed - including across the tie.
        expect(new Set(walked).size).toBe(8);
        expect([...walked].sort()).toEqual([...sent].sort());
        expect(walked).toEqual(all.messages.map((message) => message.id));

        // A customer with one thread reads the same way.
        const single = await resolveCustomerThreads(
          tenantDb,
          companyId,
          target.id,
        );
        const narrowed = await listCustomerTimeline(tenantDb, {
          threads: single!.threads.filter(
            (thread) => thread.conversationId === threads.whatsapp,
          ),
          limit: 50,
        });
        expect(narrowed.messages).toHaveLength(4);
      } finally {
        await teardown(fixture);
      }
    },
    60_000,
  );
});
