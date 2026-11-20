import { describe, expect, test } from "bun:test";
import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely } from "kysely";
import {
  activeSuppressions,
  applySuppression,
  contactMergeGroup,
  resolveInboundPolicy,
  resolveOutboundPolicy,
  revokeSuppression,
  SuppressionTargetError,
} from "./contact-policy.js";
import { createSpineTestTenant } from "./spine-test-tenant.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function customer(
  tenantDb: Kysely<TenantDatabase>,
  name: string,
  extra: { is_group?: boolean; is_blocked?: boolean } = {},
): Promise<string> {
  return (
    await tenantDb
      .insertInto("contacts")
      .values({
        whatsapp_connection_id: null,
        jid: null,
        phone_number: null,
        push_name: name,
        is_group: extra.is_group ?? false,
        is_blocked: extra.is_blocked ?? false,
        record_kind: "customer",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

async function endpointFor(
  tenantDb: Kysely<TenantDatabase>,
  accountId: string,
  contactId: string | null,
  externalId: string,
): Promise<string> {
  return (
    await tenantDb
      .insertInto("contact_endpoints")
      .values({
        contact_id: contactId,
        channel: "telegram",
        provider: "telegram_bot",
        channel_account_id: accountId,
        endpoint_kind: "person",
        external_id: externalId,
        identity_scope: "telegram:user",
        verification_state: "provider_verified",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

async function directConversation(
  tenantDb: Kysely<TenantDatabase>,
  accountId: string,
  contactId: string,
  key: string,
): Promise<string> {
  return (
    await tenantDb
      .insertInto("conversations")
      .values({
        channel_account_id: accountId,
        external_thread_id: key,
        client_thread_key: `telegram:${key}`,
        kind: "direct",
        legacy_contact_id: contactId,
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

function mergeInto(
  tenantDb: Kysely<TenantDatabase>,
  sourceId: string,
  targetId: string,
) {
  return tenantDb
    .updateTable("contacts")
    .set({ merged_into_contact_id: targetId, archived_at: new Date() })
    .where("id", "=", sourceId)
    .execute();
}

describe("contact policy", () => {
  integration(
    "a block on one half of a merged customer covers every channel, and unmerge hands each half back its own",
    async () => {
      const tenant = await createSpineTestTenant("contact-policy-merge");
      try {
        const { tenantDb, accountId, ownerId } = tenant;
        const whatsapp = await customer(tenantDb, "Ada (WhatsApp)");
        const telegram = await customer(tenantDb, "Ada (Telegram)");
        const telegramEndpoint = await endpointFor(
          tenantDb,
          accountId,
          telegram,
          "user-1",
        );
        const telegramThread = await directConversation(
          tenantDb,
          accountId,
          telegram,
          "chat-1",
        );

        // Blocked before the merge, on the half that does not survive.
        await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: whatsapp,
            scope: "block",
            reason: "manual",
            actorUserId: ownerId,
          }),
        );
        expect(
          await resolveInboundPolicy(tenantDb, {
            channelAccountId: accountId,
            senderEndpointId: telegramEndpoint,
            conversationKind: "direct",
          }),
        ).toEqual({ action: "accept" });

        await mergeInto(tenantDb, whatsapp, telegram);
        expect(await contactMergeGroup(tenantDb, whatsapp)).toEqual([
          telegram,
          whatsapp,
        ]);
        const inbound = await resolveInboundPolicy(tenantDb, {
          channelAccountId: accountId,
          senderEndpointId: telegramEndpoint,
          conversationKind: "direct",
        });
        expect(inbound.action).toBe("drop");
        expect(
          await resolveOutboundPolicy(tenantDb, {
            conversationId: telegramThread,
          }),
        ).toEqual({ allowed: false, reasonCode: "contact_blocked" });

        // Blocking the merged customer again is a no-op, not a duplicate.
        const again = await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: telegram,
            scope: "block",
            reason: "manual",
            actorUserId: ownerId,
          }),
        );
        expect(again.created).toBe(false);

        // Unmerge: the Telegram half was never blocked itself.
        await tenantDb
          .updateTable("contacts")
          .set({ merged_into_contact_id: null, archived_at: null })
          .where("id", "=", whatsapp)
          .execute();
        expect(
          (
            await resolveInboundPolicy(tenantDb, {
              channelAccountId: accountId,
              senderEndpointId: telegramEndpoint,
              conversationKind: "direct",
            })
          ).action,
        ).toBe("accept");
        expect(
          (await activeSuppressions(tenantDb, whatsapp)).map((s) => s.scope),
        ).toEqual(["block"]);
      } finally {
        await tenant.drop();
      }
    },
  );

  integration(
    "unblocking a merged customer lifts the block from every half",
    async () => {
      const tenant = await createSpineTestTenant("contact-policy-unblock");
      try {
        const { tenantDb, ownerId } = tenant;
        const left = await customer(tenantDb, "Left");
        const right = await customer(tenantDb, "Right");
        for (const contactId of [left, right]) {
          await tenantDb.transaction().execute((trx) =>
            applySuppression(trx, {
              contactId,
              scope: "block",
              reason: "manual",
              actorUserId: ownerId,
            }),
          );
        }
        await mergeInto(tenantDb, left, right);
        const revoked = await tenantDb.transaction().execute((trx) =>
          revokeSuppression(trx, {
            contactId: right,
            scope: "block",
            actorUserId: ownerId,
          }),
        );
        expect(revoked).toBe(2);
        expect(await activeSuppressions(tenantDb, left)).toEqual([]);
        expect(await activeSuppressions(tenantDb, right)).toEqual([]);
      } finally {
        await tenant.drop();
      }
    },
  );

  integration(
    "mute silences, expiry ends it, and a person block never gates a group",
    async () => {
      const tenant = await createSpineTestTenant("contact-policy-mute");
      try {
        const { tenantDb, accountId, ownerId } = tenant;
        const noisy = await customer(tenantDb, "Noisy");
        const endpoint = await endpointFor(tenantDb, accountId, noisy, "u-9");
        const now = new Date("2026-11-20T10:00:00Z");
        await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: noisy,
            scope: "mute_inbound",
            reason: "auto:rate_limit",
            actorUserId: ownerId,
            expiresAt: new Date("2026-11-20T11:00:00Z"),
            now,
          }),
        );
        const during = await resolveInboundPolicy(tenantDb, {
          channelAccountId: accountId,
          senderEndpointId: endpoint,
          conversationKind: "direct",
          now,
        });
        expect(during.action).toBe("silence");
        const after = await resolveInboundPolicy(tenantDb, {
          channelAccountId: accountId,
          senderEndpointId: endpoint,
          conversationKind: "direct",
          now: new Date("2026-11-20T11:00:01Z"),
        });
        expect(after.action).toBe("accept");

        // An expired mute does not block a fresh one from being applied.
        const renewed = await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: noisy,
            scope: "mute_inbound",
            reason: "auto:rate_limit",
            actorUserId: ownerId,
            expiresAt: new Date("2026-11-20T13:00:00Z"),
            now: new Date("2026-11-20T12:00:00Z"),
          }),
        );
        expect(renewed.created).toBe(true);

        await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: noisy,
            scope: "block",
            reason: "manual",
            actorUserId: ownerId,
          }),
        );
        expect(
          await resolveInboundPolicy(tenantDb, {
            channelAccountId: accountId,
            senderEndpointId: endpoint,
            conversationKind: "group",
          }),
        ).toEqual({ action: "accept" });
      } finally {
        await tenant.drop();
      }
    },
  );

  integration(
    "a provider block drops inbound without becoming a customer suppression",
    async () => {
      const tenant = await createSpineTestTenant("contact-policy-provider");
      try {
        const { tenantDb, accountId } = tenant;
        const person = await customer(tenantDb, "Provider-blocked");
        const endpoint = await endpointFor(tenantDb, accountId, person, "p-1");
        await tenantDb
          .insertInto("endpoint_account_states")
          .values({
            channel_account_id: accountId,
            contact_endpoint_id: endpoint,
            provider_block_state: "blocked",
          })
          .execute();
        expect(
          await resolveInboundPolicy(tenantDb, {
            channelAccountId: accountId,
            senderEndpointId: endpoint,
            conversationKind: "direct",
          }),
        ).toEqual({
          action: "drop",
          reason: "provider_blocked",
          contactId: person,
        });
        expect(await activeSuppressions(tenantDb, person)).toEqual([]);
      } finally {
        await tenant.drop();
      }
    },
  );

  integration(
    "groups and unknown contacts cannot be suppressed; the database refuses unknown scopes and duplicates",
    async () => {
      const tenant = await createSpineTestTenant("contact-policy-guards");
      try {
        const { tenantDb, ownerId } = tenant;
        const group = await customer(tenantDb, "Group", { is_group: true });
        await expect(
          tenantDb.transaction().execute((trx) =>
            applySuppression(trx, {
              contactId: group,
              scope: "block",
              reason: "manual",
              actorUserId: ownerId,
            }),
          ),
        ).rejects.toBeInstanceOf(SuppressionTargetError);
        await expect(
          tenantDb.transaction().execute((trx) =>
            applySuppression(trx, {
              contactId: crypto.randomUUID(),
              scope: "block",
              reason: "manual",
              actorUserId: ownerId,
            }),
          ),
        ).rejects.toBeInstanceOf(SuppressionTargetError);

        const person = await customer(tenantDb, "Person");
        await expect(
          tenantDb
            .insertInto("contact_suppressions")
            .values({
              contact_id: person,
              scope: "nuke" as "block",
              reason: "x",
              created_by: ownerId,
            })
            .execute(),
        ).rejects.toThrow();
        await tenantDb
          .insertInto("contact_suppressions")
          .values({
            contact_id: person,
            scope: "block",
            reason: "x",
            created_by: ownerId,
          })
          .execute();
        await expect(
          tenantDb
            .insertInto("contact_suppressions")
            .values({
              contact_id: person,
              scope: "block",
              reason: "y",
              created_by: ownerId,
            })
            .execute(),
        ).rejects.toThrow();
      } finally {
        await tenant.drop();
      }
    },
  );

  integration(
    "outbound honours the legacy is_blocked mirror and do-not-contact",
    async () => {
      const tenant = await createSpineTestTenant("contact-policy-outbound");
      try {
        const { tenantDb, accountId, ownerId } = tenant;
        const legacy = await customer(tenantDb, "Legacy", { is_blocked: true });
        const legacyThread = await directConversation(
          tenantDb,
          accountId,
          legacy,
          "chat-legacy",
        );
        expect(
          await resolveOutboundPolicy(tenantDb, {
            conversationId: legacyThread,
          }),
        ).toEqual({ allowed: false, reasonCode: "contact_blocked" });

        const optedOut = await customer(tenantDb, "Opted out");
        const optedOutThread = await directConversation(
          tenantDb,
          accountId,
          optedOut,
          "chat-dnc",
        );
        await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: optedOut,
            scope: "do_not_contact",
            reason: "customer request",
            actorUserId: ownerId,
          }),
        );
        expect(
          await resolveOutboundPolicy(tenantDb, {
            conversationId: optedOutThread,
          }),
        ).toEqual({ allowed: false, reasonCode: "contact_do_not_contact" });
      } finally {
        await tenant.drop();
      }
    },
  );
});
