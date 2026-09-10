import { createHash } from "node:crypto";
import { db } from "@wateaminbox/database";
import type {
  Channel,
  ChannelProvider,
  MessageType,
  OutboundMessageIntent,
  ProviderActionResult,
  ProviderSendResult,
} from "@wateaminbox/shared";
import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import { resolveAdapterCapabilities } from "../channel-spine/application/adapter-registry.js";
import { channelAdapterRegistry } from "../channel-spine/registry.js";
import { createLogger, formatError } from "../lib/logger.js";
import {
  enqueueOutboundRealtimeFanout,
  recordOutboundConversationActivity,
} from "./channel-message-fanout.service.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "./channel-spine-authority.service.js";
import { isChannelSpineTenantReady } from "./channel-spine-readiness.service.js";
import { getMemberWithPermissions } from "./permission.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";

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

export async function insertNeutralOutboundSend(
  trx: Transaction<TenantDatabase>,
  input: {
    companyId: string;
    actorUserId: string;
    contactId: string | null;
    conversationId: string;
    channelAccountId: string;
    content: string;
    messageType: string;
    mediaUrl?: string | null;
    caseId: string | null;
    replyToMessageId?: string | null;
    replyToExternalMessageId?: string | null;
    idempotencyKey: string;
  },
): Promise<{ messageId: string }> {
  const messageId = crypto.randomUUID();
  const normalizedPayload = {
    messageType: input.messageType,
    textContent: input.content,
    actorUserId: input.actorUserId,
    sentByUserId: input.actorUserId,
    replyToExternalMessageId: input.replyToExternalMessageId ?? null,
    attachments: input.mediaUrl
      ? [{ ordinal: 0, storageUri: input.mediaUrl }]
      : [],
  };
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex");
  await trx
    .insertInto("messages")
    .values({
      id: messageId,
      whatsapp_connection_id: null,
      contact_id: input.contactId,
      message_id: null,
      from_me: true,
      message_type: input.messageType as MessageType,
      content: input.content,
      media_url: input.mediaUrl ?? null,
      sent_by_user_id: input.actorUserId,
      status: "pending",
      metadata: {},
      timestamp: new Date(),
      case_id: input.caseId,
      channel_account_id: input.channelAccountId,
      conversation_id: input.conversationId,
      client_idempotency_key: input.idempotencyKey,
      direction: "outbound",
      reply_to_message_id: input.replyToMessageId ?? null,
      normalized_type: input.messageType,
      text_content: input.content,
      provider_metadata: {},
    })
    .execute();
  // Realtime fanout is queued with the message, in the same transaction. The
  // inbound path has always done this; outbound never did, so a message the
  // user had just sent stayed invisible in their own thread and chat list
  // until they reloaded the page.
  await enqueueOutboundRealtimeFanout(
    trx,
    input.companyId,
    input.channelAccountId,
    input.conversationId,
    messageId,
  );
  await recordOutboundConversationActivity(trx, {
    conversationId: input.conversationId,
    contactId: input.contactId,
    textContent: input.content,
    occurredAt: new Date(),
  });
  await trx
    .insertInto("outbound_message_intents")
    .values({
      channel_account_id: input.channelAccountId,
      conversation_id: input.conversationId,
      message_id: messageId,
      scheduled_message_id: null,
      operation: "send",
      idempotency_key: input.idempotencyKey,
      request_fingerprint: requestFingerprint,
      normalized_payload: normalizedPayload,
      lease_token: null,
      lease_expires_at: null,
      provider_request_id: null,
      last_error_code: null,
    })
    .execute();
  return { messageId };
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
    if (!(await isChannelSpineTenantReady(tenantDb, company.id))) continue;
    const claim = await tenantDb.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("outbound_message_intents as intent")
        .innerJoin(
          "channel_accounts as account",
          "account.id",
          "intent.channel_account_id",
        )
        .innerJoin(
          "conversations as conversation",
          "conversation.id",
          "intent.conversation_id",
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
        // A linked-device account mirrors a WhatsApp connection, and the
        // connection is the authority for whether that phone is online. The
        // mirror only refreshes when a message flows through the bridge, so a
        // phone that reconnected quietly left it reading "disconnected" - and
        // filtering on it here meant the intent was never claimed at all. It
        // would sit pending for ever while the inbox showed a sent message.
        .where((eb) =>
          eb.or([
            eb.and([
              eb("account.legacy_whatsapp_connection_id", "is", null),
              eb("account.status", "=", "connected"),
            ]),
            eb.and([
              eb("account.legacy_whatsapp_connection_id", "is not", null),
              eb.exists(
                eb
                  .selectFrom("whatsapp_connections as live")
                  .select("live.id")
                  .whereRef(
                    "live.id",
                    "=",
                    "account.legacy_whatsapp_connection_id",
                  )
                  .where("live.status", "=", "connected"),
              ),
            ]),
          ]),
        )
        .where("conversation.archived_at", "is", null)
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
    if (!(await isClaimStillAuthorized(claim))) {
      result = {
        outcome: "permanent_failure",
        errorCode: "authorization_or_resource_state_revoked",
      };
      await completeClaim(company.id, claim, result);
      return 1;
    }
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
      } else if (claim.operation.startsWith("action:")) {
        const action = await channelAdapterRegistry
          .get(claim.channel, claim.provider)
          .perform({
            companyId: claim.companyId,
            channelAccountId: claim.channelAccountId,
            conversationId: claim.conversationId,
            operation: claim.operation.slice("action:".length),
            idempotencyKey: claim.idempotencyKey,
            payload: claim.normalizedPayload,
          });
        if (action.outcome === "accepted" || action.outcome === "confirmed") {
          result = {
            outcome: action.outcome,
            providerRequestId: action.providerRequestId,
          };
        } else {
          const actionFailure = action as Exclude<
            ProviderActionResult,
            { outcome: "accepted" | "confirmed" }
          >;
          result = {
            outcome:
              actionFailure.outcome === "transient_failure"
                ? "transient_failure"
                : actionFailure.outcome === "uncertain"
                  ? "uncertain"
                  : "permanent_failure",
            errorCode: actionFailure.errorCode,
            retryAfterMs: actionFailure.retryAfterMs,
          };
        }
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

/**
 * The user an intent is dispatched on behalf of.
 *
 * Every intent - a send or an action - must name one, because dispatch
 * re-verifies that user's permission, the conversation's state, and the
 * assignment before touching the provider. An intent that omits it is
 * indistinguishable from one whose actor was revoked, and is dropped.
 */
export function intentActorUserId(
  normalizedPayload: Record<string, unknown>,
): string | null {
  const actorUserId = normalizedPayload.actorUserId;
  return typeof actorUserId === "string" && actorUserId ? actorUserId : null;
}

async function isClaimStillAuthorized(claim: ClaimedIntent): Promise<boolean> {
  const actorUserId = intentActorUserId(claim.normalizedPayload);
  if (!actorUserId) return false;
  const member = await getMemberWithPermissions(claim.companyId, actorUserId);
  if (!member?.permissions.can_send_messages) return false;
  const tenantDb = await getTenantConnection(claim.companyId);
  const conversation = await tenantDb
    .selectFrom("conversations as conversation")
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
    )
    .leftJoin(
      "whatsapp_connections as connection",
      "connection.id",
      "account.legacy_whatsapp_connection_id",
    )
    .select([
      "conversation.legacy_contact_id",
      "conversation.archived_at",
      "account.status as account_status",
      "account.legacy_whatsapp_connection_id",
      "connection.status as connection_status",
      "account.archived_at as account_archived_at",
    ])
    .where("conversation.id", "=", claim.conversationId)
    .where("conversation.channel_account_id", "=", claim.channelAccountId)
    .executeTakeFirst();
  // A linked-device account mirrors a WhatsApp connection, and that
  // connection is the authority for whether the phone is online. The mirror
  // only refreshes when a message flows through the bridge, so a phone that
  // reconnected quietly would otherwise leave every queued send unclaimed.
  const liveStatus =
    conversation?.legacy_whatsapp_connection_id != null
      ? conversation.connection_status
      : conversation?.account_status;
  if (
    !conversation ||
    conversation.archived_at ||
    conversation.account_archived_at ||
    liveStatus !== "connected"
  ) {
    return false;
  }
  if (conversation.legacy_contact_id) {
    const contact = await tenantDb
      .selectFrom("contacts")
      .select("is_blocked")
      .where("id", "=", conversation.legacy_contact_id)
      .executeTakeFirst();
    if (!contact || contact.is_blocked) return false;
  }
  const assignment = await tenantDb
    .selectFrom("contact_assignments")
    .select("assigned_to")
    .where("unassigned_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("conversation_id", "=", claim.conversationId),
        conversation.legacy_contact_id
          ? eb("contact_id", "=", conversation.legacy_contact_id)
          : eb.val(false),
      ]),
    )
    .executeTakeFirst();
  if (assignment) return assignment.assigned_to === actorUserId;
  return member.permissions.can_view_all_chats;
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
      if (
        fenced.message_id &&
        claim.operation.startsWith("action:") &&
        result.outcome === "confirmed"
      ) {
        if (claim.operation === "action:delete") {
          await trx
            .updateTable("messages")
            .set({ deleted_by_sender: true, deleted_at: new Date() })
            .where("id", "=", fenced.message_id)
            .execute();
        } else if (claim.operation === "action:edit") {
          const textContent = claim.normalizedPayload.textContent;
          if (typeof textContent === "string") {
            await trx
              .updateTable("messages")
              .set({ content: textContent, text_content: textContent })
              .where("id", "=", fenced.message_id)
              .execute();
          }
        }
      }
      if (fenced.message_id && !claim.operation.startsWith("action:")) {
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
        // The fanout queued when the message was inserted announced it while
        // it was still pending. The provider result is what turns it into a
        // sent message, and nothing told the browser, so a delivered message
        // kept spinning in the sender's own thread until they reloaded.
        //
        // The outbox is keyed on (company, message, kind) and this insert is
        // ON CONFLICT DO NOTHING, which is safe both ways round because the
        // delivery worker re-reads the message when it runs: if the earlier
        // row is still queued the insert is dropped and that row delivers the
        // status set just above, and if the worker already holds it the
        // insert waits on the key and lands once the delivered row is gone.
        await enqueueOutboundRealtimeFanout(
          trx,
          companyId,
          claim.channelAccountId,
          claim.conversationId,
          fenced.message_id,
        );
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
    if (
      fenced.message_id &&
      !transient &&
      failure.outcome !== "uncertain" &&
      !claim.operation.startsWith("action:")
    ) {
      await trx
        .updateTable("messages")
        .set({ status: "failed" })
        .where("id", "=", fenced.message_id)
        .execute();
      // A send that failed must stop looking pending as well, or the sender
      // waits on a message that is never going anywhere.
      await enqueueOutboundRealtimeFanout(
        trx,
        companyId,
        claim.channelAccountId,
        claim.conversationId,
        fenced.message_id,
      );
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
