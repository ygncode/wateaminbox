/**
 * Message Reaction Routes
 *
 * Routes for adding and removing reactions from messages.
 */

import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { resolveAdapterCapabilities } from "../../channel-spine/application/adapter-registry.js";
import { channelAdapterRegistry } from "../../channel-spine/registry.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../../services/channel-spine-authority.service.js";
import { isChannelSpineTenantReady } from "../../services/channel-spine-readiness.service.js";
import { requireConversationSendAccess } from "../../services/send-access.service.js";
import { broadcastToConversationViewers } from "../../services/message-broadcast.service.js";
import { zValidator } from "@hono/zod-validator";
import { nowMs } from "@wateaminbox/shared";
import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  buildCommandSubject,
  buildSendReactionCommand,
} from "../../lib/nats/index.js";
import { broadcastToContactViewers } from "../../services/message-broadcast.service.js";
import { successData } from "../../lib/response.js";
import { addReactionSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { requireMessageVisibility } from "../../middleware/resource-visibility.js";
import { enqueueCommand } from "../../services/command-outbox.service.js";
import { requireSendAccess } from "../../services/send-access.service.js";
import { getActiveSessionId } from "../../services/whatsapp/session.js";

export const reactionRoutes = new Hono();

// A reaction is an outbound WhatsApp action like any other send - it must
// respect the same visibility, permission, and assignment/lifecycle
// invariants (see requireSendAccess), not just message-content edits.
reactionRoutes.use("/:id/reaction", requireMessageVisibility());
reactionRoutes.use("/:id/reaction", requireMessageSendPermission);

/**
 * POST /:id/reaction - Add a reaction to a message
 */
reactionRoutes.post(
  "/:id/reaction",
  zValidator("json", addReactionSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const messageId = c.req.param("id");
    const body = c.req.valid("json");

    // Check message exists and get WhatsApp message_id, from_me, and contact ID
    const message = await tenantDb
      .selectFrom("messages")
      .select([
        "id",
        "contact_id",
        "message_id",
        "from_me",
        "sender_jid",
        "metadata",
        "whatsapp_connection_id",
        "channel_account_id",
        "conversation_id",
        "external_message_id",
      ])
      .where("id", "=", messageId)
      .executeTakeFirst();

    if (!message) {
      return notFound(c, "Message");
    }

    // A message on a neutral channel account has no WhatsApp id, JID, or
    // connection to react through. Its reaction is an outbound action intent
    // the adapter performs, so it is handled before the WhatsApp checks below
    // rather than failing them.
    if (message.channel_account_id && !message.whatsapp_connection_id) {
      return reactOnChannel(c, message, body.emoji);
    }

    if (!message.contact_id) {
      return badRequest(c, "Message has no associated contact");
    }

    if (!message.message_id) {
      return badRequest(c, "Message has no WhatsApp message ID");
    }

    // Get contact to determine chat JID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["jid"])
      .where("id", "=", message.contact_id)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Contact or JID");
    }

    const connection = message.whatsapp_connection_id
      ? await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["id", "status", "jid"])
          .where("id", "=", message.whatsapp_connection_id)
          .where("status", "=", "connected")
          .executeTakeFirst()
      : null;

    if (!connection) {
      return badRequest(c, "No active WhatsApp connection");
    }

    if (!connection.jid) {
      return badRequest(c, "WhatsApp connection has no JID");
    }

    const protocolSenderJid =
      typeof message.metadata?.protocolSenderJid === "string"
        ? message.metadata.protocolSenderJid
        : undefined;
    const isGroup = contact.jid.endsWith("@g.us");
    if (
      isGroup &&
      !message.from_me &&
      !protocolSenderJid &&
      !message.sender_jid
    ) {
      return badRequest(c, "Group message has no sender JID");
    }
    const targetSenderJid = message.from_me
      ? connection.jid
      : protocolSenderJid || message.sender_jid || contact.jid;
    const sessionId = await getActiveSessionId(tenantDb, connection.id);
    const reactionCommand = buildSendReactionCommand(
      sessionId,
      contact.jid,
      message.message_id,
      body.emoji,
      user.id,
      message.from_me,
      targetSenderJid,
    );
    await tenantDb.transaction().execute(async (trx) => {
      // `claimUnassigned: false` - reacting must never itself claim an
      // unassigned contact as a side effect, but it must still respect an
      // existing assignment and the active-case lifecycle invariant, under
      // the same contact-row lock an interactive send uses.
      await requireSendAccess(trx, message.contact_id as string, user.id, {
        claimUnassigned: false,
      });
      await trx
        .insertInto("message_reactions")
        .values({
          message_id: messageId,
          reactor_jid: connection.jid!,
          emoji: body.emoji,
        })
        .onConflict((oc) =>
          oc.columns(["message_id", "reactor_jid"]).doUpdateSet({
            emoji: body.emoji,
          }),
        )
        .execute();
      await enqueueCommand(
        trx,
        buildCommandSubject(companyId, sessionId),
        reactionCommand,
      );
    });

    await broadcastToContactViewers(
      companyId,
      message.contact_id,
      "message:reaction",
      {
        messageId,
        contactId: message.contact_id,
        from: connection.jid,
        emoji: body.emoji,
        isOwn: true,
        timestamp: nowMs(),
      },
      { connectionId: connection.id },
    );

    return successData(c, {
      emoji: body.emoji,
      reactorJid: connection.jid,
      isOwn: true,
    });
  },
);

/**
 * DELETE /:id/reaction - Remove a reaction from a message
 */
reactionRoutes.delete("/:id/reaction", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const messageId = c.req.param("id");

  // Get message with WhatsApp message_id, from_me, and contact info
  const message = await tenantDb
    .selectFrom("messages")
    .select([
      "id",
      "contact_id",
      "message_id",
      "from_me",
      "sender_jid",
      "metadata",
      "whatsapp_connection_id",
    ])
    .where("id", "=", messageId)
    .executeTakeFirst();

  if (!message) {
    return notFound(c, "Message");
  }

  const connection = message.whatsapp_connection_id
    ? await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "status", "jid"])
        .where("id", "=", message.whatsapp_connection_id)
        .where("status", "=", "connected")
        .executeTakeFirst()
    : null;

  const reactorJid = connection?.jid || user.id;

  // Same assignment/lifecycle invariant as adding a reaction - checked once
  // up front (a pure guard here; `claimUnassigned: false` never mutates
  // anything) since both branches below need it identically.
  if (message.contact_id) {
    await tenantDb.transaction().execute((trx) =>
      requireSendAccess(trx, message.contact_id as string, user.id, {
        claimUnassigned: false,
      }),
    );
  }

  // Send empty emoji to WhatsApp to remove reaction (if we have contact info)
  let deletedInTransaction = false;
  if (message.contact_id && message.message_id && connection) {
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["jid"])
      .where("id", "=", message.contact_id)
      .executeTakeFirst();

    if (contact?.jid) {
      const protocolSenderJid =
        typeof message.metadata?.protocolSenderJid === "string"
          ? message.metadata.protocolSenderJid
          : undefined;
      const isGroup = contact.jid.endsWith("@g.us");
      if (
        isGroup &&
        !message.from_me &&
        !protocolSenderJid &&
        !message.sender_jid
      ) {
        return badRequest(c, "Group message has no sender JID");
      }
      const targetSenderJid = message.from_me
        ? connection.jid || undefined
        : protocolSenderJid || message.sender_jid || contact.jid;
      const sessionId = await getActiveSessionId(tenantDb, connection.id);
      const reactionCommand = buildSendReactionCommand(
        sessionId,
        contact.jid,
        message.message_id,
        "",
        user.id,
        message.from_me,
        targetSenderJid,
      );
      await tenantDb.transaction().execute(async (trx) => {
        await trx
          .deleteFrom("message_reactions")
          .where("message_id", "=", messageId)
          .where("reactor_jid", "=", reactorJid)
          .execute();
        await enqueueCommand(
          trx,
          buildCommandSubject(companyId, sessionId),
          reactionCommand,
        );
      });
      deletedInTransaction = true;
    }
  }

  if (!deletedInTransaction) {
    await tenantDb
      .deleteFrom("message_reactions")
      .where("message_id", "=", messageId)
      .where("reactor_jid", "=", reactorJid)
      .execute();
  }

  if (connection) {
    await broadcastToContactViewers(
      companyId,
      message.contact_id,
      "message:reaction",
      {
        messageId,
        contactId: message.contact_id,
        from: reactorJid,
        emoji: "",
        timestamp: nowMs(),
      },
      { connectionId: connection.id },
    );
  }

  return successData(c, {
    emoji: "",
    reactorJid,
    isOwn: true,
  });
});

/**
 * React to a message on a channel-neutral account.
 *
 * The reaction is persisted locally and queued as an outbound action intent;
 * the adapter performs it and the dispatcher fences it exactly like a send.
 * Reacting never claims an unassigned conversation, matching the WhatsApp
 * path: a reaction is a light gesture, not a decision to own the thread.
 */
async function reactOnChannel(
  c: Context,
  message: {
    id: string;
    contact_id: string | null;
    channel_account_id: string | null;
    conversation_id: string | null;
    external_message_id: string | null;
  },
  emoji: string,
) {
  const { tenantDb, user, companyId } = getRouteContext(c);
  if (!message.conversation_id || !message.channel_account_id) {
    return badRequest(c, "Message is not on a channel conversation");
  }
  const account = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "channel", "provider", "status"])
    .where("id", "=", message.channel_account_id)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!account) return notFound(c, "Channel account");

  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  if (
    authority.writeAuthority !== "neutral" ||
    !isChannelProviderEnabled(authority, account.provider) ||
    !(await isChannelSpineTenantReady(tenantDb, companyId))
  ) {
    return badRequest(c, "Neutral channel writes are not enabled");
  }
  if (!isChannel(account.channel) || !isChannelProvider(account.provider)) {
    return badRequest(c, "The channel adapter is not available");
  }
  const capabilities = await resolveAdapterCapabilities(
    channelAdapterRegistry,
    account.channel,
    account.provider,
    {
      companyId,
      channelAccountId: account.id,
      conversationId: message.conversation_id,
      now: new Date().toISOString(),
    },
  );
  if (!capabilities.reactions) {
    return badRequest(c, "This channel does not support reactions");
  }

  // One intent per (message, reactor, emoji): re-sending the same reaction is
  // the same request, while changing it is a new one the provider must see.
  const idempotencyKey = `reaction:${message.id}:${user.id}:${emoji}`;
  // The adapter addresses the provider's own message, not ours.
  if (!message.external_message_id) {
    return badRequest(c, "Message has not been delivered yet");
  }
  // `actorUserId` is not decoration: the dispatcher re-verifies at send time
  // that this user still has send permission, that the conversation is still
  // live, and that assignment still allows it. An intent without it fails
  // that check and is discarded as revoked before the adapter is ever called.
  const normalizedPayload = buildChannelReactionPayload({
    actorUserId: user.id,
    emoji,
    messageId: message.id,
    externalMessageId: message.external_message_id,
  });
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex");

  await tenantDb.transaction().execute(async (trx) => {
    await requireConversationSendAccess(
      trx,
      message.conversation_id as string,
      user.id,
      { claimUnassigned: false },
    );
    await trx
      .insertInto("message_reactions")
      .values({
        message_id: message.id,
        reactor_jid: `user:${user.id}`,
        emoji,
        channel_account_id: account.id,
      })
      .onConflict((oc) =>
        oc.columns(["message_id", "reactor_jid"]).doUpdateSet({ emoji }),
      )
      .execute();
    await trx
      .insertInto("outbound_message_intents")
      .values({
        channel_account_id: account.id,
        conversation_id: message.conversation_id as string,
        // Names the message being reacted to. Allowed alongside that
        // message's own send intent: the one-send-per-message unique index
        // excludes `action:` operations.
        message_id: message.id,
        scheduled_message_id: null,
        operation: "action:reaction",
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
        normalized_payload: normalizedPayload,
        lease_token: null,
        lease_expires_at: null,
        provider_request_id: null,
        last_error_code: null,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  });

  await broadcastToConversationViewers(
    companyId,
    message.conversation_id,
    "message:reaction",
    {
      messageId: message.id,
      contactId: message.contact_id,
      conversationId: message.conversation_id,
      from: `user:${user.id}`,
      emoji,
      isOwn: true,
      timestamp: nowMs(),
    },
  );
  return successData(c, {
    emoji,
    reactorJid: `user:${user.id}`,
    isOwn: true,
  });
}

/** The stored payload for a channel reaction intent. */
export function buildChannelReactionPayload(input: {
  actorUserId: string;
  emoji: string;
  messageId: string;
  externalMessageId: string;
}): {
  actorUserId: string;
  emoji: string;
  messageId: string;
  externalMessageId: string;
} {
  return {
    actorUserId: input.actorUserId,
    emoji: input.emoji,
    messageId: input.messageId,
    externalMessageId: input.externalMessageId,
  };
}
