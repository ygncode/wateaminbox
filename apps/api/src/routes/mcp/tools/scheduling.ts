import { getContactDisplayName, toDbDate } from "@wateaminbox/shared";
import { sql } from "kysely";
import { z } from "zod";
import {
  rateLimitConfig,
  rateLimitStore,
  RateLimitStoreUnavailableError,
} from "../../../lib/rate-limit-store.js";
import {
  SCHEDULE_MAX_HORIZON_MS,
  SCHEDULE_MIN_LEAD_MS,
} from "../../../lib/schemas/index.js";
import { getRouteContext } from "../../../middleware/context.js";
import { broadcastAutoAssignment } from "../../../services/assignment-broadcast.service.js";
import {
  findOrCreateContactByPhone,
  OutboundContactError,
} from "../../../services/contact.service.js";
import { reserveMediaReferences } from "../../../services/media-reference-lock.js";
import {
  broadcastToContactViewers,
  broadcastToConversationViewers,
} from "../../../services/message-broadcast.service.js";
import {
  requireConversationSendAccess,
  requireSendAccess,
} from "../../../services/send-access.service.js";
import { type McpToolDefinition, McpToolError } from "../tool-context.js";
import { requireVisibleContact, requireVisibleWorkflow } from "./read.js";

export const schedulingTools: McpToolDefinition[] = [
  {
    name: "create_contact",
    description:
      "Create a contact without sending a message or opening a conversation. Reuses a matching contact on the selected connection without changing its name or notes. The number is not checked against WhatsApp's registry. Use list_connections to select the sender, then add notes/tags. Before scheduling a first message, use update_conversation_state with action 'open'.",
    scope: "write",
    inputSchema: {
      phoneNumber: z
        .string()
        .min(1)
        .describe("International phone number; leading + or 00 accepted"),
      connectionId: z
        .string()
        .uuid()
        .optional()
        .describe("Required when multiple WhatsApp accounts are connected"),
      customName: z.string().trim().max(255).optional(),
      notesShared: z.string().trim().max(10000).optional(),
    },
    handler: async (
      args: {
        phoneNumber: string;
        connectionId?: string;
        customName?: string;
        notesShared?: string;
      },
      c,
    ) => {
      const { tenantDb } = getRouteContext(c);
      try {
        const result = await findOrCreateContactByPhone(tenantDb, args);
        // A duplicate must not disclose another teammate's hidden contact.
        if (!result.created) await requireVisibleContact(c, result.contact.id);
        return {
          contactId: result.contact.id,
          connectionId: result.connectionId,
          contactCreated: result.created,
          phoneNumber: result.contact.phone_number,
          displayName: getContactDisplayName(result.contact),
          messageSent: false,
        };
      } catch (error) {
        if (error instanceof OutboundContactError)
          throw new McpToolError(error.message);
        throw error;
      }
    },
  },
  {
    name: "schedule_message",
    description:
      "Schedule one normal text message to an existing contact or conversation, without a broadcast. HIGH IMPACT: confirm recipient, wording and time before calling. Pass contactId or conversationId. Requires an open/pending conversation; for a new contact use update_conversation_state action 'open' first. Reuse the same scheduledMessageId and exact payload on retries; a changed payload with that ID is rejected. Delivery is server-side and rechecks send access at dispatch. Pending schedules can be inspected or canceled in the app.",
    scope: "write",
    permission: "can_send_messages",
    inputSchema: {
      contactId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
      content: z.string().trim().min(1).max(65536),
      scheduledAt: z
        .string()
        .datetime({ offset: true })
        .describe("ISO datetime with timezone, 30 seconds to one year ahead"),
      scheduledMessageId: z
        .string()
        .uuid()
        .describe(
          "Client-generated UUID; reuse unchanged for retries of this message",
        ),
    },
    handler: async (
      args: {
        contactId?: string;
        conversationId?: string;
        content: string;
        scheduledAt: string;
        scheduledMessageId: string;
      },
      c,
    ) => {
      const { tenantDb, user, companyId } = getRouteContext(c);
      const targetId = args.conversationId ?? args.contactId;
      if (!targetId)
        throw new McpToolError("contactId or conversationId is required");
      const identity = await requireVisibleWorkflow(c, targetId);
      if (!identity.conversationId && !identity.contactId)
        throw new McpToolError("Contact not found");
      const contactId = identity.contactId;
      const conversationId = identity.conversationId;
      if (rateLimitConfig.enabled) {
        const tier = rateLimitConfig.tiers.messaging.send;
        try {
          const limit = await rateLimitStore.increment(
            `messaging-schedule:user:${user.id}`,
            tier.requests,
            tier.windowSeconds,
          );
          if (!limit.allowed)
            throw new McpToolError(
              `Scheduling rate limit exceeded; retry in ${limit.retryAfter} seconds`,
            );
        } catch (error) {
          if (error instanceof RateLimitStoreUnavailableError)
            throw new McpToolError(
              "Scheduling rate limiting is temporarily unavailable; retry shortly",
            );
          throw error;
        }
      }
      const scheduledAt = new Date(args.scheduledAt);
      const content = args.content.trim();
      if (!content)
        throw new McpToolError("content is required for text messages");
      const result = await tenantDb.transaction().execute(async (trx) => {
        // Serialize identical request IDs, including concurrent requests for different contacts.
        await sql`select pg_advisory_xact_lock(hashtextextended(${companyId + ":" + args.scheduledMessageId}, 0))`.execute(
          trx,
        );
        const existing = await trx
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", args.scheduledMessageId)
          .executeTakeFirst();
        if (existing) {
          if (
            existing.created_by !== user.id ||
            existing.contact_id !== contactId ||
            existing.conversation_id !== conversationId ||
            existing.content !== content ||
            new Date(existing.scheduled_at).getTime() !==
              scheduledAt.getTime() ||
            existing.message_type !== "text" ||
            existing.bulk_job_id ||
            existing.media_url ||
            existing.reply_to_message_id
          ) {
            throw new McpToolError(
              "scheduledMessageId is already used for a different request",
            );
          }
          return { row: existing, alreadyExisted: true, autoAssigned: false };
        }
        const lead = scheduledAt.getTime() - Date.now();
        if (!Number.isFinite(lead) || lead < SCHEDULE_MIN_LEAD_MS)
          throw new McpToolError(
            "scheduledAt must be at least 30 seconds in the future",
          );
        if (lead > SCHEDULE_MAX_HORIZON_MS)
          throw new McpToolError("scheduledAt must be within one year");
        // Use the same transaction guards and lock order as REST schedule creation.
        await reserveMediaReferences(trx, companyId, [null]);
        let autoAssigned = false;
        if (contactId) {
          const contact = await trx
            .selectFrom("contacts")
            .select(["jid", "whatsapp_connection_id"])
            .where("id", "=", contactId)
            .executeTakeFirstOrThrow();
          if (!contact.jid || !contact.whatsapp_connection_id)
            throw new McpToolError(
              "The contact has no WhatsApp connection or JID",
            );
          const access = await requireSendAccess(trx, contactId, user.id);
          autoAssigned = access.autoAssigned;
        } else {
          const access = await requireConversationSendAccess(
            trx,
            conversationId!,
            user.id,
          );
          autoAssigned = access.autoAssigned;
        }
        const now = toDbDate();
        const row = await trx
          .insertInto("scheduled_messages")
          .values({
            id: args.scheduledMessageId,
            contact_id: contactId,
            conversation_id: conversationId,
            content,
            message_type: "text",
            scheduled_at: scheduledAt,
            status: "scheduled",
            attempts: 0,
            next_attempt_at: scheduledAt,
            created_by: user.id,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return {
          row,
          alreadyExisted: false,
          autoAssigned,
        };
      });
      if (result.autoAssigned && contactId)
        await broadcastAutoAssignment(tenantDb, companyId, contactId, user.id);
      if (!result.alreadyExisted) {
        const payload = {
          scheduledMessageId: result.row.id,
          conversationId: conversationId ?? contactId,
          status: "scheduled",
        };
        if (contactId) {
          await broadcastToContactViewers(
            companyId,
            contactId,
            "scheduled_message:updated",
            payload,
          );
        } else {
          await broadcastToConversationViewers(
            companyId,
            conversationId,
            "scheduled_message:updated",
            payload,
          );
        }
      }
      return {
        scheduledMessageId: result.row.id,
        contactId: result.row.contact_id,
        conversationId: result.row.conversation_id,
        scheduledAt: new Date(result.row.scheduled_at).toISOString(),
        status: result.row.status,
        alreadyExisted: result.alreadyExisted,
        autoAssigned: result.autoAssigned,
      };
    },
  },
];
