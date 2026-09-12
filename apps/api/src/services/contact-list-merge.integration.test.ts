import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { mergeContacts } from "./contact-merge.service.js";
import { getContactsWithLastMessage } from "./contact.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * The inbox list after a merge.
 *
 * This exercises the real list SQL rather than the compiled clause, because
 * the collapse adds a lateral to a query whose own comments record a variant
 * that ran for over five minutes before it was cancelled. The shape has to be
 * proven against a real planner, not just a string.
 */
describe("getContactsWithLastMessage after a merge", () => {
  integrationTest(
    "shows one row per customer, and never loses an assigned chat",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `contact-list-merge-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Contact list merge test",
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

        const account = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: account,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            display_name: "Linked device",
            status: "connected",
          })
          .execute();

        const target = await tenantDb
          .insertInto("contacts")
          .values({ jid: "60123456789@s.whatsapp.net", push_name: "Ada" })
          .returning("id")
          .executeTakeFirstOrThrow();
        const source = await tenantDb
          .insertInto("contacts")
          .values({ jid: "60987654321@s.whatsapp.net", push_name: "Ada 2" })
          .returning("id")
          .executeTakeFirstOrThrow();
        for (const contactId of [target.id, source.id]) {
          await tenantDb
            .insertInto("contact_endpoints")
            .values({
              contact_id: contactId,
              channel: "whatsapp",
              provider: "whatsapp_linked_device",
              channel_account_id: account,
              endpoint_kind: "phone",
              external_id: `${contactId}@s.whatsapp.net`,
              identity_scope: "global",
            })
            .execute();
        }

        // Everything unread, and the only assignment, sits on the contact that
        // the merge is about to hide.
        await tenantDb
          .insertInto("conversation_states")
          .values({
            contact_id: source.id,
            unread_count: 3,
            last_message_at: new Date("2026-01-03T00:00:00Z"),
          })
          .execute();
        await tenantDb
          .insertInto("contact_assignments")
          .values({
            contact_id: source.id,
            assigned_to: ownerId,
            assigned_by: ownerId,
          })
          .execute();

        const before = await getContactsWithLastMessage(tenantDb, companyId);
        expect(before.total).toBe(2);

        await mergeContacts(tenantDb, {
          sourceContactId: source.id,
          targetContactId: target.id,
          actorUserId: ownerId,
          reason: "Same customer, confirmed by the operator",
        });

        const after = await getContactsWithLastMessage(tenantDb, companyId);
        expect(after.contacts.map((contact) => contact.id)).toEqual([
          target.id,
        ]);
        // The count query is separate; if it kept counting the hidden row,
        // pagination would report a page that is not there.
        expect(after.total).toBe(1);

        const survivor = after.contacts[0]!;
        expect(survivor.chat_count).toBe(2);
        // Unread arrived on the hidden thread. Dropping it here is what makes
        // a collapse read as lost messages.
        expect(Number(survivor.unread_count)).toBe(3);
        expect(survivor.last_message_at).toEqual(
          new Date("2026-01-03T00:00:00Z"),
        );

        // The assignment is on the hidden row, so the surviving row has to
        // answer for it or the chat vanishes from its assignee's filter.
        const mine = await getContactsWithLastMessage(tenantDb, companyId, {
          assignedToMe: true,
          userId: ownerId,
        });
        expect(mine.contacts.map((contact) => contact.id)).toEqual([target.id]);
        // The count query is built separately from the row query, so every
        // filter answered from the merged group has to be mirrored into it.
        expect(mine.total).toBe(1);

        const unread = await getContactsWithLastMessage(tenantDb, companyId, {
          unreadOnly: true,
        });
        expect(unread.contacts.map((contact) => contact.id)).toEqual([
          target.id,
        ]);
        expect(unread.total).toBe(1);

        // Nobody else holds it, but the group does, so it is not unassigned.
        const unassigned = await getContactsWithLastMessage(
          tenantDb,
          companyId,
          { unassigned: true },
        );
        expect(unassigned.contacts).toHaveLength(0);
        expect(unassigned.total).toBe(0);
      } finally {
        clearTenantConnection(companyId);
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
    60_000,
  );
});
