import { db } from "@wateaminbox/database";
import type {
  Channel,
  ChannelProvider,
  OutboundMessageIntent,
  ProviderSendResult,
} from "@wateaminbox/shared";
import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import { sql } from "kysely";
import { resolveAdapterCapabilities } from "../channel-spine/application/adapter-registry.js";
import { channelAdapterRegistry } from "../channel-spine/registry.js";
import { createLogger, formatError } from "../lib/logger.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "./channel-spine-authority.service.js";
import { getTenantConnection } from "./tenant.service.js";

const logger = createLogger("ChannelOutbound");
const LEASE_MS = 30_000;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

interface ClaimedIntent extends OutboundMessageIntent {
  leaseToken: string;
  channel: Channel;
  provider: ChannelProvider;
}

export async function dispatchNextChannelOutbound(): Promise<number> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  for (const company of companies) {
    const authority = await getChannelSpineWorkspaceAuthority(company.id);
    if (authority.writeAuthority !== "neutral") continue;
    const tenantDb = await getTenantConnection(company.id);
    const claim = await tenantDb.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("outbound_message_intents as intent")
        .innerJoin(
          "channel_accounts as account",
          "account.id",
          "intent.channel_account_id",
        )
        .select([
          "intent.id",
          "intent.channel_account_id",
          "intent.conversation_id",
          "intent.message_id",
          "intent.operation",
          "intent.idempotency_key",
          "intent.request_fingerprint",
          "intent.normalized_payload",
          "intent.attempts",
          "account.channel",
          "account.provider",
        ])
        .where("intent.status", "=", "pending")
        .where("intent.next_attempt_at", "<=", new Date())
        .where("account.archived_at", "is", null)
        .where("account.provider", "in", authority.enabledProviders)
        .orderBy("intent.next_attempt_at")
        .orderBy("intent.created_at")
        .forUpdate("intent")
        .skipLocked()
        .executeTakeFirst();
      if (!row || !isChannel(row.channel) || !isChannelProvider(row.provider))
        return null;
      if (!isChannelProviderEnabled(authority, row.provider)) return null;
      const leaseToken = crypto.randomUUID();
      const updated = await trx
        .updateTable("outbound_message_intents")
        .set({
          status: "dispatching",
          lease_token: leaseToken,
          lease_expires_at: new Date(Date.now() + LEASE_MS),
          attempts: sql`attempts + 1`,
          updated_at: new Date(),
        })
        .where("id", "=", row.id)
        .where("status", "=", "pending")
        .returning("id")
        .executeTakeFirst();
      if (!updated) return null;
      return {
        id: row.id,
        companyId: company.id,
        channelAccountId: row.channel_account_id,
        conversationId: row.conversation_id,
        messageId: row.message_id ?? undefined,
        operation: row.operation,
        idempotencyKey: row.idempotency_key,
        requestFingerprint: row.request_fingerprint,
        normalizedPayload: row.normalized_payload,
        attemptKey: `${row.id}:${Number(row.attempts) + 1}`,
        leaseToken,
        provider: row.provider,
        channel: row.channel,
      };
    });
    if (!claim) continue;

    let result: ProviderSendResult;
    try {
      // Capability resolution is part of the fail-closed dispatch path, not a
      // UI-only hint. Invalid provider capability state cannot send.
      const capabilities = await resolveAdapterCapabilities(
        channelAdapterRegistry,
        claim.channel,
        claim.provider,
        {
          companyId: company.id,
          channelAccountId: claim.channelAccountId,
          conversationId: claim.conversationId,
          messageId: claim.messageId,
          now: new Date().toISOString(),
        },
      );
      if (!capabilities.outboundInitiation && claim.operation === "initiate") {
        result = {
          outcome: "permanent_failure",
          errorCode: "outbound_initiation_unsupported",
        };
      } else {
        result = await channelAdapterRegistry
          .get(claim.channel, claim.provider)
          .send(claim);
      }
    } catch {
      result = {
        outcome: "uncertain",
        errorCode: "adapter_outcome_unknown",
      };
    }
    await completeClaim(company.id, claim, result);
    return 1;
  }
  return 0;
}

async function completeClaim(
  companyId: string,
  claim: ClaimedIntent,
  result: ProviderSendResult,
): Promise<void> {
  const tenantDb = await getTenantConnection(companyId);
  await tenantDb.transaction().execute(async (trx) => {
    const fenced = await trx
      .selectFrom("outbound_message_intents")
      .select(["id", "attempts", "message_id"])
      .where("id", "=", claim.id)
      .where("status", "=", "dispatching")
      .where("lease_token", "=", claim.leaseToken)
      .forUpdate()
      .executeTakeFirst();
    if (!fenced) return;
    const common = {
      lease_token: null,
      lease_expires_at: null,
      provider_request_id: result.providerRequestId ?? null,
      updated_at: new Date(),
    };
    if (result.outcome === "accepted" || result.outcome === "confirmed") {
      await trx
        .updateTable("outbound_message_intents")
        .set({
          ...common,
          status: result.outcome === "confirmed" ? "confirmed" : "handed_off",
          last_error_code: null,
        })
        .where("id", "=", claim.id)
        .execute();
      if (fenced.message_id) {
        await trx
          .updateTable("messages")
          .set({
            status: result.outcome === "confirmed" ? "sent" : "pending",
            ...(result.externalMessageId
              ? {
                  message_id: result.externalMessageId,
                  external_message_id: result.externalMessageId,
                }
              : {}),
            ...(result.externalIdentityScope
              ? { external_identity_scope: result.externalIdentityScope }
              : {}),
          })
          .where("id", "=", fenced.message_id)
          .execute();
      }
      return;
    }
    const failure = result as Exclude<
      ProviderSendResult,
      { outcome: "accepted" | "confirmed" }
    >;
    const transient = failure.outcome === "transient_failure";
    await trx
      .updateTable("outbound_message_intents")
      .set({
        ...common,
        status: transient
          ? "pending"
          : failure.outcome === "uncertain"
            ? "uncertain"
            : "failed",
        next_attempt_at: transient
          ? new Date(
              Date.now() +
                (failure.retryAfterMs ??
                  Math.min(
                    15 * 60_000,
                    5_000 * 2 ** Math.min(fenced.attempts, 8),
                  )),
            )
          : new Date(),
        last_error_code: failure.errorCode,
      })
      .where("id", "=", claim.id)
      .execute();
    if (fenced.message_id && !transient) {
      await trx
        .updateTable("messages")
        .set({ status: "failed" })
        .where("id", "=", fenced.message_id)
        .execute();
    }
  });
}

async function recoverExpiredLeases(): Promise<void> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .execute();
  for (const company of companies) {
    const tenantDb = await getTenantConnection(company.id);
    await tenantDb
      .updateTable("outbound_message_intents")
      .set({
        status: "uncertain",
        lease_token: null,
        lease_expires_at: null,
        last_error_code: "dispatch_lease_expired_outcome_unknown",
        updated_at: new Date(),
      })
      .where("status", "=", "dispatching")
      .where("lease_expires_at", "<", new Date())
      .execute();
  }
}

async function poll(): Promise<void> {
  if (running || stopping) return;
  running = true;
  let processed = 0;
  try {
    processed = await dispatchNextChannelOutbound();
  } catch (error) {
    logger.warn({ err: formatError(error) }, "Channel outbound polling failed");
  } finally {
    running = false;
    if (!stopping) timer = setTimeout(poll, processed ? 25 : 1_000);
  }
}

export function initializeChannelOutbound(): void {
  stopping = false;
  void recoverExpiredLeases().finally(() => {
    if (!stopping && !timer) timer = setTimeout(poll, 0);
  });
}

export async function shutdownChannelOutbound(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) await new Promise((resolve) => setTimeout(resolve, 25));
}
