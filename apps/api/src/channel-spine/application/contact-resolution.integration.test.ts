import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";
import {
  DEFAULT_SLA_WEEKLY_SCHEDULE,
  type NormalizedChannelEvent,
} from "@wateaminbox/shared";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";
import { applyNormalizedChannelEvent } from "./event-processor.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface EventOptions {
  threadKey: string;
  messageId: string;
  kind: "direct" | "group";
  senderId: string;
  endpointKind?: string;
  displayName?: string;
  direction?: "inbound" | "outbound";
}

function event(
  companyId: string,
  channelAccountId: string,
  options: EventOptions,
): Extract<NormalizedChannelEvent, { kind: "message.upsert" }> {
  return {
    contractVersion: 1,
    eventId: `update-${options.messageId}`,
    companyId,
    channelAccountId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "message.upsert",
    providerOccurredAt: "2026-09-08T12:00:00.000Z",
    receivedAt: "2026-09-08T12:00:01.000Z",
    payload: {
      conversation: {
        externalThreadId: options.threadKey,
        clientThreadKey: `telegram:${options.threadKey}:root`,
        kind: options.kind,
      },
      externalMessageId: options.messageId,
      externalIdentityScope: `telegram:${options.threadKey}`,
      direction: options.direction ?? "inbound",
      sender: {
        externalId: options.senderId,
        identityScope: "telegram:user",
        endpointKind: options.endpointKind ?? "person",
        displayName: options.displayName ?? "Ada",
      },
      normalizedType: "text",
      textContent: "hello",
    },
  };
}

/**
 * What neutral ingest refuses to call a customer.
 *
 * Resolution creates identity automatically, so its refusals matter more than
 * its successes: a wrong customer row silently attaches a thread - and
 * everything an operator later does to it - to the wrong person.
 */
integration(
  "resolves a customer only for a single person in a direct thread",
  async () => {
    const companyId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Contact resolution test",
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
          external_account_id: "bot-1",
          external_scope_id: "telegram",
          status: "connected",
          connected_at: new Date(),
        })
        .execute();

      const customersNamed = async (name: string) =>
        Number(
          (
            await tenantDb
              .selectFrom("contacts")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .where("push_name", "=", name)
              .executeTakeFirstOrThrow()
          ).count,
        );

      // A group is a thread, not a person. Folding one into a customer would
      // put a whole audience behind a single identity.
      await applyNormalizedChannelEvent(
        tenantDb,
        event(companyId, accountId, {
          threadKey: "chat-group",
          messageId: "m-group",
          kind: "group",
          senderId: "user-group",
          displayName: "Group Member",
        }),
      );
      expect(await customersNamed("Group Member")).toBe(0);

      // A bot is not a customer either, whatever thread it speaks in.
      await applyNormalizedChannelEvent(
        tenantDb,
        event(companyId, accountId, {
          threadKey: "chat-bot",
          messageId: "m-bot",
          kind: "direct",
          senderId: "user-bot",
          endpointKind: "bot",
          displayName: "Helper Bot",
        }),
      );
      expect(await customersNamed("Helper Bot")).toBe(0);

      // The ordinary case, and it must happen on the very first message
      // rather than waiting for a participant row to exist.
      await applyNormalizedChannelEvent(
        tenantDb,
        event(companyId, accountId, {
          threadKey: "chat-direct",
          messageId: "m-direct",
          kind: "direct",
          senderId: "user-direct",
          displayName: "Ada",
        }),
      );
      expect(await customersNamed("Ada")).toBe(1);

      // A second message from the same person adopts the customer already
      // resolved instead of creating a second one - `contacts` has no unique
      // key to stop that when there is no WhatsApp connection.
      await applyNormalizedChannelEvent(
        tenantDb,
        event(companyId, accountId, {
          threadKey: "chat-direct",
          messageId: "m-direct-2",
          kind: "direct",
          senderId: "user-direct",
          displayName: "Ada",
        }),
      );
      expect(await customersNamed("Ada")).toBe(1);
    } finally {
      clearTenantConnection(companyId);
      // The tenant's cases reference the workspace SLA policy, so the schema
      // has to go before the policy it points at.
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db
        .deleteFrom("sla_policies")
        .where("company_id", "=", companyId)
        .execute();
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  60_000,
);
