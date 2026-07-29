/**
 * Message Reaction Routes
 *
 * Routes for adding and removing reactions from messages.
 */

import { zValidator } from "@hono/zod-validator";
import { nowMs } from "@wateaminbox/shared";
import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  buildCommandSubject,
  buildSendReactionCommand,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { successData } from "../../lib/response.js";
import { addReactionSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { enqueueCommand } from "../../services/command-outbox.service.js";

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
    const reactionCommand = buildSendReactionCommand(
      connection.id,
      contact.jid,
      message.message_id,
      body.emoji,
      user.id,
      message.from_me,
      targetSenderJid,
    );
    await tenantDb.transaction().execute(async (trx) => {
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
        buildCommandSubject(companyId, connection.id),
        reactionCommand,
      );
    });

    await broadcastToCompany(
      companyId,
      "message:reaction",
      {
        messageId,
        contactId: message.contact_id,
        from: connection.jid,
        emoji: body.emoji,
        isOwn: true,
        timestamp: nowMs(),
      },
      connection.id,
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
      const reactionCommand = buildSendReactionCommand(
        connection.id,
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
          buildCommandSubject(companyId, connection.id),
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
    await broadcastToCompany(
      companyId,
      "message:reaction",
      {
        messageId,
        contactId: message.contact_id,
        from: reactorJid,
        emoji: "",
        timestamp: nowMs(),
      },
      connection.id,
    );
  }

  return successData(c, {
    emoji: "",
    reactorJid,
    isOwn: true,
  });
});
