import { expect, test } from "bun:test";
import type { NormalizedChannelEvent } from "@wateaminbox/shared";
import { applyNormalizedChannelEvent } from "./event-processor.js";
import { createSpineTestTenant } from "./spine-test-tenant.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

function endpointState(
  companyId: string,
  channelAccountId: string,
  eventId: string,
  payload: Extract<
    NormalizedChannelEvent,
    { kind: "endpoint.state" }
  >["payload"],
): Extract<NormalizedChannelEvent, { kind: "endpoint.state" }> {
  return {
    contractVersion: 1,
    eventId,
    companyId,
    channelAccountId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "endpoint.state",
    receivedAt: "2026-11-20T10:00:00.000Z",
    payload,
  };
}

integration(
  "endpoint.state records provider facts and never creates a suppression",
  async () => {
    const tenant = await createSpineTestTenant("endpoint-state");
    try {
      const { tenantDb, companyId, accountId } = tenant;
      const endpoint = {
        externalId: "user-77",
        identityScope: "telegram:user",
        endpointKind: "person",
        displayName: "Mallory",
      };
      expect(
        (
          await applyNormalizedChannelEvent(
            tenantDb,
            endpointState(companyId, accountId, "member-1", {
              endpoint,
              reachability: "unreachable",
              reason: "kicked",
            }),
          )
        ).outcome,
      ).toBe("applied");

      const state = await tenantDb
        .selectFrom("endpoint_account_states")
        .select(["provider_block_state", "provider_status"])
        .where("channel_account_id", "=", accountId)
        .executeTakeFirstOrThrow();
      expect(state.provider_block_state).toBe("unknown");
      expect(state.provider_status).toBe("unreachable");

      // A later fact that names only the block state keeps reachability.
      await applyNormalizedChannelEvent(
        tenantDb,
        endpointState(companyId, accountId, "member-2", {
          endpoint,
          providerBlockState: "blocked",
        }),
      );
      const updated = await tenantDb
        .selectFrom("endpoint_account_states")
        .select(["provider_block_state", "provider_status"])
        .where("channel_account_id", "=", accountId)
        .executeTakeFirstOrThrow();
      expect(updated.provider_block_state).toBe("blocked");
      expect(updated.provider_status).toBe("unreachable");

      const suppressions = await tenantDb
        .selectFrom("contact_suppressions")
        .select("id")
        .execute();
      expect(suppressions).toHaveLength(0);
    } finally {
      await tenant.drop();
    }
  },
);
