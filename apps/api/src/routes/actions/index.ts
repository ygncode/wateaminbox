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
import { broadcastToCompanyExcept } from "../../lib/pusher.js";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import { authMiddleware } from "../../middleware/auth.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import { tenantFromHeader } from "../../middleware/tenant.js";
import * as whatsappService from "../../services/whatsapp.service.js";
import {
  ConnectionNotFoundError,
  InvalidConnectionStateError,
} from "../../lib/errors.js";

const logger = createLogger("ActionsRoutes");

// Rate limiter for messaging actions
const messagingRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.messaging.whatsapp,
    keyStrategy: "user",
    keyPrefix: "actions-msg",
  },
  rateLimitConfig.enabled,
);

// Schema for send message request
const sendMessageSchema = z.object({
  jid: z.string().min(1),
  content: z.string().optional(),
  messageType: z.enum(["text", "image", "audio", "video", "document"]).default("text"),
  mediaUrl: z.string().optional(),
});

// Schema for typing indicator request
const typingSchema = z.object({
  conversationId: z.string().min(1),
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
  messagingRateLimiter,
  zValidator("json", sendMessageSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");
    const input = c.req.valid("json");

    // Validate that mediaUrl is provided for non-text messages
    if (input.messageType !== "text" && !input.mediaUrl) {
      throw new HTTPException(400, {
        message: `mediaUrl is required for ${input.messageType} messages`,
      });
    }

    try {
      const result = await whatsappService.sendMessage(
        tenantDb,
        companyId,
        user.id,
        {
          jid: input.jid,
          content: input.content,
          messageType: input.messageType,
          mediaUrl: input.mediaUrl,
        },
      );

      return c.json({
        success: true,
        data: {
          messageId: result.messageId,
          status: "pending",
          message: "Message queued for sending",
        },
      });
    } catch (error) {
      if (error instanceof InvalidConnectionStateError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      logger.error({ err: formatError(error) }, "Failed to send message");
      throw new HTTPException(500, {
        message: "Failed to send message",
      });
    }
  },
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
    const { conversationId, isTyping } = c.req.valid("json");

    // Get socket_id from header if provided (Pusher sends this)
    const socketId = c.req.header("X-Pusher-Socket-Id");

    const eventType = isTyping ? "typing:start" : "typing:stop";
    const payload = {
      conversationId,
      userId: user.id,
      userName: user.name || user.email,
    };

    try {
      // Broadcast to other clients (excluding the sender if socketId provided)
      await broadcastToCompanyExcept(
        companyId,
        eventType,
        payload,
        socketId,
      );

      return c.json({
        success: true,
        data: {
          eventType,
          conversationId,
        },
      });
    } catch (error) {
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
