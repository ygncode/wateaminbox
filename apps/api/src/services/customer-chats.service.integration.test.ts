import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { mergeContacts } from "./contact-merge.service.js";
import { listCustomerChats } from "./customer-chats.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("listCustomerChats", () => {
  integrationTest(
    "keeps both threads of a merged customer reachable, from either side",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `customer-chats-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Customer chats test",
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
            effective_from: new Date("1970-01-01T00:00:00Z"),
            created_by: ownerId,
          })
          .execute();
        await createTenantSchema(companyId);
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
          .values({ jid: null, push_name: "Ada (Telegram)" })
          .returning("id")
          .executeTakeFirstOrThrow();

        const endpoints = await tenantDb
          .insertInto("contact_endpoints")
          .values([
            {
              contact_id: target.id,
              channel: "whatsapp",
              provider: "whatsapp_linked_device",
              channel_account_id: whatsappAccount,
              endpoint_kind: "phone",
              external_id: "60123456789@s.whatsapp.net",
              identity_scope: "global",
              address_display: "+60 12 345 6789",
            },
            {
              contact_id: source.id,
              channel: "telegram",
              provider: "telegram_bot",
              channel_account_id: telegramAccount,
              endpoint_kind: "user",
              external_id: "77001",
              identity_scope: "account",
              address_display: "@ada",
            },
          ])
          .returning(["id", "channel"])
          .execute();

        for (const endpoint of endpoints) {
          const account =
            endpoint.channel === "whatsapp" ? whatsappAccount : telegramAccount;
          const conversation = await tenantDb
            .insertInto("conversations")
            .values({
              channel_account_id: account,
              client_thread_key: `${endpoint.channel}:${crypto.randomUUID()}`,
              kind: "direct",
              legacy_contact_id:
                endpoint.channel === "whatsapp" ? target.id : source.id,
              last_message_at: new Date(
                endpoint.channel === "whatsapp"
                  ? "2026-01-02T00:00:00Z"
                  : "2026-01-01T00:00:00Z",
              ),
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
        }

        // Before the merge each contact is its own customer with one thread.
        expect(await listCustomerChats(tenantDb, target.id)).toHaveLength(1);
        expect(await listCustomerChats(tenantDb, source.id)).toHaveLength(1);

        await mergeContacts(tenantDb, {
          sourceContactId: source.id,
          targetContactId: target.id,
          actorUserId: ownerId,
          reason: "Same customer, confirmed by the operator",
        });

        const chats = await listCustomerChats(tenantDb, target.id);
        expect(chats).toHaveLength(2);
        // The id must be the one an inbox row carries - the conversation when
        // there is one. The switcher compares it against the open chat to mark
        // the current thread and hands it back to the router to switch, so an
        // inverted preference makes every neutral thread unrecognisable as the
        // one already open.
        expect(chats.map((chat) => chat.chatId)).toEqual(
          chats.map((chat) => chat.conversationId ?? chat.contactId),
        );
        // Newest thread first, and each keeps the id the chat route addresses.
        expect(chats.map((chat) => chat.contactId ?? "")).toEqual([
          target.id,
          source.id,
        ]);
        expect(chats.map((chat) => chat.channel)).toEqual([
          "whatsapp",
          "telegram",
        ]);
        expect(chats.map((chat) => chat.address)).toEqual([
          "+60 12 345 6789",
          "@ada",
        ]);

        // Asking from the merged-away side answers for the same customer, so
        // an old chat URL still offers the whole switcher.
        const fromSource = await listCustomerChats(tenantDb, source.id);
        expect(fromSource.map((chat) => chat.contactId ?? "")).toEqual([
          target.id,
          source.id,
        ]);
      } finally {
        clearTenantConnection(companyId);
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
    60_000,
  );
});
