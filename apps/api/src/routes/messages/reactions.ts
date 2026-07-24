/**
 * Message Reaction Routes
 *
 * Routes for adding and removing reactions from messages.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { nowMs } from "@wateaminbox/shared";
import { badRequest, notFound } from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { publishSendReaction } from "../../lib/nats/index.js";
import { successData, successMessage } from "../../lib/response.js";
import { addReactionSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { broadcastToCompany } from "../../lib/pusher.js";

const logger = createLogger("MessageReactionRoutes");

export const reactionRoutes = new Hono();

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
      .select(["id", "contact_id", "message_id", "from_me"])
      .where("id", "=", messageId)
      .executeTakeFirst();

    if (!message) {
      return notFound(c, "Message");
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

    // Get active WhatsApp connection (need jid to match sync events)
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "status", "jid"])
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      return badRequest(c, "No active WhatsApp connection");
    }

    if (!connection.jid) {
      return badRequest(c, "WhatsApp connection has no JID");
    }

    // Upsert reaction in database (replace if user already reacted)
    // Use connection.jid to match WhatsApp sync events (not user.id)
    await tenantDb
      .insertInto("message_reactions")
      .values({
        message_id: messageId,
        reactor_jid: connection.jid, // Use WhatsApp JID to match sync events
        emoji: body.emoji,
      })
      .onConflict((oc) =>
        oc.columns(["message_id", "reactor_jid"]).doUpdateSet({
          emoji: body.emoji,
        }),
      )
      .execute();

    await broadcastToCompany(
      companyId,
      "message:reaction",
      {
        messageId,
        contactId: message.contact_id,
        from: connection.jid,
        emoji: body.emoji,
        timestamp: nowMs(),
      },
      connection.id,
    );

    // Send reaction to WhatsApp via NATS
    try {
      await publishSendReaction(
        companyId,
        connection.id,
        contact.jid,
        message.message_id, // Use WhatsApp message_id
        body.emoji,
        user.id,
        message.from_me, // Pass from_me flag
      );
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "Failed to send reaction to WhatsApp",
      );
      // Don't fail the request - the reaction is stored in DB
    }

    return successData(c, { emoji: body.emoji, reactorJid: connection.jid });
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
    .select(["id", "contact_id", "message_id", "from_me"])
    .where("id", "=", messageId)
    .executeTakeFirst();

  if (!message) {
    return notFound(c, "Message");
  }

  // Get active WhatsApp connection (need jid to match sync events)
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status", "jid"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  // Delete reaction from database using connection.jid (to match sync events)
  const reactorJid = connection?.jid || user.id;
  await tenantDb
    .deleteFrom("message_reactions")
    .where("message_id", "=", messageId)
    .where("reactor_jid", "=", reactorJid)
    .execute();

  // Broadcast reaction removal to all connected realtime clients for real-time updates
  if (connection) {
    await broadcastToCompany(
      companyId,
      "message:reaction",
      {
        messageId,
        contactId: message.contact_id,
        from: reactorJid,
        emoji: "", // Empty emoji indicates removal
        timestamp: nowMs(),
      },
      connection.id,
    );
  }

  // Send empty emoji to WhatsApp to remove reaction (if we have contact info)
  if (message.contact_id && message.message_id && connection) {
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["jid"])
      .where("id", "=", message.contact_id)
      .executeTakeFirst();

    if (contact?.jid) {
      try {
        await publishSendReaction(
          companyId,
          connection.id,
          contact.jid,
          message.message_id, // Use WhatsApp message_id
          "", // Empty emoji removes the reaction
          user.id,
          message.from_me, // Pass from_me flag
        );
      } catch (error) {
        logger.error(
          { err: formatError(error) },
          "Failed to remove reaction from WhatsApp",
        );
        // Don't fail the request - the reaction is removed from DB
      }
    }
  }

  return successMessage(c, "Reaction removed");
});
