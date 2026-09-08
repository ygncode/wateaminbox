import { zValidator } from "@hono/zod-validator";
import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { resolveAdapterCapabilities } from "../../channel-spine/application/adapter-registry.js";
import { channelAdapterRegistry } from "../../channel-spine/registry.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../../services/channel-spine-authority.service.js";

const actionSchema = z
  .object({
    operation: z.enum(["edit", "delete", "reaction"]),
    messageId: z.string().uuid(),
    textContent: z.string().max(4096).optional(),
    emoji: z.string().min(1).max(32).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "edit" && value.textContent === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "textContent is required for edit",
      });
    }
    if (value.operation === "reaction" && value.emoji === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "emoji is required for reaction",
      });
    }
  });

export const neutralActionRoutes = new Hono();

neutralActionRoutes.post(
  "/:id/actions",
  requireMessageSendPermission,
  zValidator("json", actionSchema),
  async (c) => {
    const { tenantDb, companyId } = getRouteContext(c);
    const conversationId = c.req.param("id");
    const authority = await getChannelSpineWorkspaceAuthority(companyId);
    if (authority.writeAuthority !== "neutral") {
      return notFound(c, "Neutral conversation actions");
    }
    const conversation = await tenantDb
      .selectFrom("conversations as conversation")
      .innerJoin(
        "channel_accounts as account",
        "account.id",
        "conversation.channel_account_id",
      )
      .select([
        "conversation.id",
        "conversation.channel_account_id",
        "account.channel",
        "account.provider",
      ])
      .where("conversation.id", "=", conversationId)
      .where("conversation.archived_at", "is", null)
      .executeTakeFirst();
    if (
      !conversation ||
      !isChannel(conversation.channel) ||
      !isChannelProvider(conversation.provider) ||
      !isChannelProviderEnabled(authority, conversation.provider)
    ) {
      return notFound(c, "Conversation");
    }
    const body = c.req.valid("json");
    const message = await tenantDb
      .selectFrom("messages")
      .select("external_message_id")
      .where("id", "=", body.messageId)
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst();
    if (!message?.external_message_id) return notFound(c, "Message");

    const capabilities = await resolveAdapterCapabilities(
      channelAdapterRegistry,
      conversation.channel,
      conversation.provider,
      {
        companyId,
        channelAccountId: conversation.channel_account_id,
        conversationId,
        messageId: body.messageId,
        now: new Date().toISOString(),
      },
    );
    const allowed =
      body.operation === "edit"
        ? capabilities.messageEditing
        : body.operation === "delete"
          ? capabilities.actions.deleteForEveryone
          : capabilities.reactions;
    if (!allowed)
      return badRequest(c, "Action is not supported by this channel");

    const idempotencyKey = c.req.header("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return badRequest(c, "A valid Idempotency-Key header is required");
    }
    const payload = {
      externalMessageId: message.external_message_id,
      textContent: body.textContent,
      emoji: body.emoji,
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ operation: body.operation, payload }))
      .digest("hex");
    const operation = `action:${body.operation}`;
    const existing = await tenantDb
      .selectFrom("outbound_message_intents")
      .select(["id", "status", "request_fingerprint"])
      .where("channel_account_id", "=", conversation.channel_account_id)
      .where("operation", "=", operation)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        return conflict(c, "Idempotency-Key was reused with another action");
      }
      return successData(
        c,
        { intentId: existing.id, status: existing.status },
        202,
      );
    }
    const intent = await tenantDb
      .insertInto("outbound_message_intents")
      .values({
        channel_account_id: conversation.channel_account_id,
        conversation_id: conversationId,
        message_id: body.messageId,
        scheduled_message_id: null,
        operation,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        normalized_payload: payload,
        lease_token: null,
        lease_expires_at: null,
        provider_request_id: null,
        last_error_code: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return successData(c, { intentId: intent.id, status: "pending" }, 202);
  },
);
