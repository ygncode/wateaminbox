/**
 * Actions Routes
 *
 * REST endpoints for client actions that were previously handled via WebSocket.
 * These endpoints allow clients to trigger actions without maintaining a WebSocket connection.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createLogger, formatError } from "../../lib/logger.js";
import { publishTypingCommand } from "../../lib/nats/index.js";
import { broadcastToCompanyExcept } from "../../lib/pusher.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  legacyMessageSendRemoved,
  requireMessageSendPermission,
} from "../../middleware/message-send-policy.js";
import { tenantFromHeader } from "../../middleware/tenant.js";

const logger = createLogger("ActionsRoutes");

// Schema for typing indicator request
const typingSchema = z.object({
  conversationId: z.string().min(1),
  contactId: z.string().uuid(),
  isTyping: z.boolean(),
});

export const actionsRoutes = new Hono();

/**
 * POST /messages/send - Send a WhatsApp message
 *
 * This replaces the WebSocket-based send_message functionality.
 */
actionsRoutes.post(
  "/messages/send",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requireMessageSendPermission,
  legacyMessageSendRemoved,
);

/**
 * POST /messages/typing - Send typing indicator
 *
 * Broadcasts typing status to other clients in the company channel.
 * The caller's socket_id can be passed to exclude them from receiving the event.
 */
actionsRoutes.post(
  "/messages/typing",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  zValidator("json", typingSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const { conversationId, contactId, isTyping } = c.req.valid("json");

    // Get socket_id from header if provided (Pusher sends this)
    const socketId = c.req.header("X-Pusher-Socket-Id");

    const eventType = isTyping ? "typing:start" : "typing:stop";
    const payload = {
      conversationId,
      userId: user.id,
      userName: user.name || user.email,
    };

    try {
      const tenantDb = c.get("tenantDb");
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["jid", "whatsapp_connection_id"])
        .where("id", "=", contactId)
        .executeTakeFirst();
      if (!contact?.jid || !contact.whatsapp_connection_id) {
        throw new HTTPException(404, { message: "Contact not found" });
      }
      if (contact.jid !== conversationId) {
        throw new HTTPException(400, { message: "Conversation JID mismatch" });
      }

      await Promise.all([
        broadcastToCompanyExcept(companyId, eventType, payload, socketId),
        publishTypingCommand(
          companyId,
          contact.whatsapp_connection_id,
          contact.jid,
          isTyping,
        ),
      ]);

      return c.json({
        success: true,
        data: {
          eventType,
          conversationId,
        },
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      logger.error(
        { err: formatError(error) },
        "Failed to broadcast typing indicator",
      );
      throw new HTTPException(500, {
        message: "Failed to send typing indicator",
      });
    }
  },
);

/**
 * POST /messages/read - Mark messages as read
 *
 * This can be used to notify other clients that messages have been read.
 */
actionsRoutes.post(
  "/messages/read",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  zValidator(
    "json",
    z.object({
      conversationId: z.string().min(1),
      messageIds: z.array(z.string()).optional(),
    }),
  ),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const { conversationId, messageIds } = c.req.valid("json");
    const socketId = c.req.header("X-Pusher-Socket-Id");

    try {
      // Broadcast read event to other clients
      await broadcastToCompanyExcept(
        companyId,
        "conversation:read",
        {
          contactId: conversationId,
          readBy: user.id,
          messageIds,
        },
        socketId,
      );

      return c.json({
        success: true,
        data: { conversationId },
      });
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "Failed to broadcast read status",
      );
      throw new HTTPException(500, {
        message: "Failed to send read status",
      });
    }
  },
);

export default actionsRoutes;
