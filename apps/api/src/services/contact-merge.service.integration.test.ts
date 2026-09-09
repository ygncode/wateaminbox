import { describe, expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { ConflictError, ValidationError } from "../lib/errors.js";
import { resolveWorkflowIdentity } from "./channel-workflow.service.js";
import {
  mergeContacts,
  resolveCanonicalContactId,
  suggestContactMerges,
} from "./contact-merge.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("mergeContacts", () => {
  integrationTest(
    "moves endpoints to the surviving contact and leaves every conversation and workflow row in place",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `contact-merge-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Contact merge test",
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
            created_by: ownerId,
          })
          .execute();
        await createTenantSchema(companyId);
        await reconcileChannelSpineConcurrentIndexes(db, schemaName);
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
        const groupContact = await tenantDb
          .insertInto("contacts")
          .values({ jid: "120@g.us", is_group: true, push_name: "Team" })
          .returning("id")
          .executeTakeFirstOrThrow();

        const targetEndpoint = await tenantDb
          .insertInto("contact_endpoints")
          .values({
            contact_id: target.id,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            channel_account_id: whatsappAccount,
            endpoint_kind: "phone",
            external_id: "60123456789@s.whatsapp.net",
            identity_scope: "global",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const sourceEndpoint = await tenantDb
          .insertInto("contact_endpoints")
          .values({
            contact_id: source.id,
            channel: "telegram",
            provider: "telegram_bot",
            channel_account_id: telegramAccount,
            endpoint_kind: "user",
            external_id: "77001",
            identity_scope: "account",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        // The merged-away contact keeps its own conversation and its history.
        const sourceConversation = await tenantDb
          .insertInto("conversations")
          .values({
            channel_account_id: telegramAccount,
            client_thread_key: `telegram:${crypto.randomUUID()}`,
            kind: "direct",
            subject: "Ada (Telegram)",
            legacy_contact_id: source.id,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const messageId = crypto.randomUUID();
        await tenantDb
          .insertInto("messages")
          .values({
            id: messageId,
            contact_id: source.id,
            conversation_id: sourceConversation.id,
            channel_account_id: telegramAccount,
            from_me: false,
            message_type: "text",
            content: "hello",
            timestamp: new Date(),
          })
          .execute();
        const assignment = await tenantDb
          .insertInto("contact_assignments")
          .values({
            contact_id: source.id,
            conversation_id: sourceConversation.id,
            assigned_to: ownerId,
            assigned_by: ownerId,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        // Suggestions come from shared normalized addresses, never from names.
        await tenantDb
          .updateTable("contact_endpoints")
          .set({ normalized_address: "60123456789" })
          .where("contact_id", "in", [target.id, source.id])
          .execute();
        const suggestions = await suggestContactMerges(tenantDb, target.id);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]!.contactId).toBe(source.id);
        expect(suggestions[0]!.matchedAddress).toBe("60123456789");
        expect(suggestions[0]!.channels).toEqual(["telegram"]);
        expect(suggestions[0]!.sameChannel).toBe(false);
        expect(suggestions[0]!.verified).toBe(false);
        // A group endpoint is a shared identity and is never a candidate.
        await tenantDb
          .insertInto("contact_endpoints")
          .values({
            contact_id: groupContact.id,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            channel_account_id: whatsappAccount,
            endpoint_kind: "group",
            external_id: "120@g.us",
            identity_scope: "global",
            normalized_address: "60123456789",
          })
          .execute();
        expect(
          (await suggestContactMerges(tenantDb, target.id)).map(
            (suggestion) => suggestion.contactId,
          ),
        ).toEqual([source.id]);
        await expect(
          mergeContacts(tenantDb, {
            sourceContactId: groupContact.id,
            targetContactId: target.id,
            actorUserId: ownerId,
            reason: "shared identity",
          }),
        ).rejects.toBeInstanceOf(ValidationError);

        await expect(
          mergeContacts(tenantDb, {
            sourceContactId: source.id,
            targetContactId: source.id,
            actorUserId: ownerId,
            reason: "same row",
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          mergeContacts(tenantDb, {
            sourceContactId: groupContact.id,
            targetContactId: target.id,
            actorUserId: ownerId,
            reason: "group",
          }),
        ).rejects.toBeInstanceOf(ValidationError);

        const result = await mergeContacts(tenantDb, {
          sourceContactId: source.id,
          targetContactId: target.id,
          actorUserId: ownerId,
          reason: "same person on two channels",
        });
        expect(result.movedEndpoints).toBe(1);
        expect(result.targetContactId).toBe(target.id);

        const endpoints = await tenantDb
          .selectFrom("contact_endpoints")
          .select(["id", "contact_id"])
          .where("id", "in", [targetEndpoint.id, sourceEndpoint.id])
          .orderBy("id")
          .execute();
        expect(
          endpoints.every((endpoint) => endpoint.contact_id === target.id),
        ).toBe(true);
        expect(endpoints.map((endpoint) => endpoint.id).sort()).toEqual(
          [targetEndpoint.id, sourceEndpoint.id].sort(),
        );

        const reassignments = await tenantDb
          .selectFrom("contact_endpoint_reassignment_events")
          .selectAll()
          .execute();

        expect(reassignments).toHaveLength(1);
        expect(reassignments[0]!.merge_event_id).toBe(result.mergeEventId);
        expect(reassignments[0]!.previous_contact_id).toBe(source.id);
        expect(reassignments[0]!.new_contact_id).toBe(target.id);

        const mergeEvent = await tenantDb
          .selectFrom("contact_merge_events")
          .selectAll()
          .where("id", "=", result.mergeEventId)
          .executeTakeFirstOrThrow();
        expect(mergeEvent.source_contact_id).toBe(source.id);
        expect(mergeEvent.target_contact_id).toBe(target.id);
        expect(mergeEvent.actor_user_id).toBe(ownerId);
        expect(mergeEvent.endpoint_snapshot).toHaveLength(1);

        const mergedSource = await tenantDb
          .selectFrom("contacts")
          .select(["merged_into_contact_id", "archived_at"])
          .where("id", "=", source.id)
          .executeTakeFirstOrThrow();
        expect(mergedSource.merged_into_contact_id).toBe(target.id);
        expect(mergedSource.archived_at).not.toBeNull();

        // Conversation history and workflow ownership are untouched.
        const conversation = await tenantDb
          .selectFrom("conversations")
          .select(["legacy_contact_id", "archived_at"])
          .where("id", "=", sourceConversation.id)
          .executeTakeFirstOrThrow();
        expect(conversation.legacy_contact_id).toBe(source.id);
        expect(conversation.archived_at).toBeNull();
        const message = await tenantDb
          .selectFrom("messages")
          .select(["contact_id", "conversation_id"])
          .where("id", "=", messageId)
          .executeTakeFirstOrThrow();
        expect(message.contact_id).toBe(source.id);
        expect(message.conversation_id).toBe(sourceConversation.id);
        const keptAssignment = await tenantDb
          .selectFrom("contact_assignments")
          .select(["contact_id", "conversation_id", "unassigned_at"])
          .where("id", "=", assignment.id)
          .executeTakeFirstOrThrow();
        expect(keptAssignment.contact_id).toBe(source.id);
        expect(keptAssignment.conversation_id).toBe(sourceConversation.id);
        expect(keptAssignment.unassigned_at).toBeNull();

        expect(await suggestContactMerges(tenantDb, target.id)).toEqual([]);

        // Contact-profile reads follow the alias; conversation identity never does.
        expect(await resolveCanonicalContactId(tenantDb, source.id)).toBe(
          target.id,
        );
        expect(await resolveCanonicalContactId(tenantDb, target.id)).toBe(
          target.id,
        );
        const identity = await resolveWorkflowIdentity(
          tenantDb,
          sourceConversation.id,
        );
        expect(identity?.conversationId).toBe(sourceConversation.id);
        expect(identity?.contactId).toBe(source.id);

        // A merged contact cannot be merged again in either direction.
        await expect(
          mergeContacts(tenantDb, {
            sourceContactId: source.id,
            targetContactId: target.id,
            actorUserId: ownerId,
            reason: "repeat",
          }),
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(
          mergeContacts(tenantDb, {
            sourceContactId: target.id,
            targetContactId: source.id,
            actorUserId: ownerId,
            reason: "reverse",
          }),
        ).rejects.toBeInstanceOf(ConflictError);
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );
});
