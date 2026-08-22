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
import { hasContactVisibility } from "../../middleware/resource-visibility.js";
import { broadcastToContactViewers } from "../../services/message-broadcast.service.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  legacyMessageSendRemoved,
  requireMessageSendPermission,
} from "../../middleware/message-send-policy.js";
import { tenantFromHeader } from "../../middleware/tenant.js";
import { NoActiveCaseError } from "../../lib/errors.js";
import {
  ContactAssignedToOtherError,
  ContactBlockedError,
  requireSendAccess,
} from "../../services/send-access.service.js";
import { getActiveSessionId } from "../../services/whatsapp/session.js";

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
 * The caller's realtime client ID can be passed to exclude it from the event.
 */
actionsRoutes.post(
  "/messages/typing",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  requireMessageSendPermission,
  zValidator("json", typingSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const { conversationId, contactId, isTyping } = c.req.valid("json");

    const clientId = c.req.header("X-Realtime-Client-Id");

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
      // Only starting a stray "is typing" signal is worth blocking - always
      // let a "stopped typing" through so a stale indicator can never get
      // stuck client-side. Uses the SAME shared guard an interactive send
      // does (assignment + active-case lifecycle), transactionally (the
      // contact-row lock closes the same takeover TOCTOU window), but with
      // `claimUnassigned: false` - merely typing must never itself claim an
      // unassigned contact as a side effect.
      if (isTyping) {
        try {
          await tenantDb.transaction().execute((trx) =>
            requireSendAccess(trx, contactId, user.id, {
              claimUnassigned: false,
            }),
          );
        } catch (error) {
          if (error instanceof ContactAssignedToOtherError) {
            throw new HTTPException(403, { message: error.message });
          }
          if (
            error instanceof NoActiveCaseError ||
            error instanceof ContactBlockedError
          ) {
            throw new HTTPException(409, { message: error.message });
          }
          throw error;
        }
      }
      const sessionId = await getActiveSessionId(
        tenantDb,
        contact.whatsapp_connection_id,
      );

      await Promise.all([
        broadcastToContactViewers(companyId, contactId, eventType, payload, {
          excludeClientId: clientId,
        }),
        publishTypingCommand(companyId, sessionId, contact.jid, isTyping),
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
      // A tenant contact ID, not a JID - the payload below publishes it as
      // `contactId`, and the viewer resolver keys on it. Validating the shape
      // here keeps a non-UUID from reaching PostgreSQL as a cast error.
      conversationId: z.string().uuid(),
      messageIds: z.array(z.string()).optional(),
    }),
  ),
  async (c) => {
    const companyId = c.get("companyId");
    const tenantDb = c.get("tenantDb");
    const user = c.get("user");
    const { conversationId, messageIds } = c.req.valid("json");
    const clientId = c.req.header("X-Realtime-Client-Id");

    // The contact ID arrives in the body, so the path-param visibility
    // middleware cannot guard this route. Without these checks a member who
    // cannot see a conversation could inject a "read by me" signal into it,
    // which its real viewers would display.
    //
    // Existence is checked separately from visibility because
    // `hasContactVisibility` short-circuits on `can_view_all_chats` - without
    // it, an admin passing any random UUID would publish an event naming a
    // conversation that does not exist. 404 for both, matching
    // requireContactVisibility: never disclose which of the two it was.
    const contact = await tenantDb
      .selectFrom("contacts")
      .select("id")
      .where("id", "=", conversationId)
      .executeTakeFirst();
    if (!contact || !(await hasContactVisibility(c, conversationId))) {
      throw new HTTPException(404, { message: "Conversation not found" });
    }

    try {
      // Broadcast read event to other clients
      await broadcastToContactViewers(
        companyId,
        conversationId,
        "conversation:read",
        {
          contactId: conversationId,
          readBy: user.id,
          messageIds,
        },
        { excludeClientId: clientId },
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
