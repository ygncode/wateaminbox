/**
 * Message Reaction Routes
 *
 * Routes for adding and removing reactions from messages.
 */
import { Hono } from 'hono'
import { badRequest, notFound } from '../../lib/errors.js'
import { createLogger, formatError } from '../../lib/logger.js'
import { publishSendReaction } from '../../lib/nats/index.js'
import { getRouteContext } from '../../middleware/context.js'

const logger = createLogger('MessageReactionRoutes')

export const reactionRoutes = new Hono()

/**
 * POST /:id/reaction - Add a reaction to a message
 */
reactionRoutes.post('/:id/reaction', async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c)
  const messageId = c.req.param('id')
  const body = await c.req.json()

  const { emoji } = body

  if (!emoji) {
    return badRequest(c, 'emoji is required')
  }

  // Check message exists and get WhatsApp message_id, from_me, and contact ID
  const message = await tenantDb
    .selectFrom('messages')
    .select(['id', 'contact_id', 'message_id', 'from_me'])
    .where('id', '=', messageId)
    .executeTakeFirst()

  if (!message) {
    return notFound(c, 'Message')
  }

  if (!message.contact_id) {
    return badRequest(c, 'Message has no associated contact')
  }

  if (!message.message_id) {
    return badRequest(c, 'Message has no WhatsApp message ID')
  }

  // Get contact to determine chat JID
  const contact = await tenantDb
    .selectFrom('contacts')
    .select(['jid'])
    .where('id', '=', message.contact_id)
    .executeTakeFirst()

  if (!contact || !contact.jid) {
    return notFound(c, 'Contact or JID')
  }

  // Get active WhatsApp connection
  const connection = await tenantDb
    .selectFrom('whatsapp_connections')
    .select(['id', 'status'])
    .where('status', '=', 'connected')
    .executeTakeFirst()

  if (!connection) {
    return badRequest(c, 'No active WhatsApp connection')
  }

  // Upsert reaction in database
  await tenantDb
    .insertInto('message_reactions')
    .values({
      message_id: messageId,
      reactor_jid: user.id, // Using user ID as reactor
      emoji,
    })
    .execute()

  // Send reaction to WhatsApp via NATS
  try {
    await publishSendReaction(
      companyId,
      connection.id,
      contact.jid,
      message.message_id, // Use WhatsApp message_id
      emoji,
      user.id,
      message.from_me // Pass from_me flag
    )
  } catch (error) {
    logger.error({ err: formatError(error) }, 'Failed to send reaction to WhatsApp')
    // Don't fail the request - the reaction is stored in DB
  }

  return c.json({ success: true, emoji })
})

/**
 * DELETE /:id/reaction - Remove a reaction from a message
 */
reactionRoutes.delete('/:id/reaction', async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c)
  const messageId = c.req.param('id')

  // Get message with WhatsApp message_id, from_me, and contact info
  const message = await tenantDb
    .selectFrom('messages')
    .select(['id', 'contact_id', 'message_id', 'from_me'])
    .where('id', '=', messageId)
    .executeTakeFirst()

  if (!message) {
    return notFound(c, 'Message')
  }

  // Delete reaction from database
  await tenantDb
    .deleteFrom('message_reactions')
    .where('message_id', '=', messageId)
    .where('reactor_jid', '=', user.id)
    .execute()

  // Send empty emoji to WhatsApp to remove reaction (if we have contact info)
  if (message.contact_id && message.message_id) {
    const contact = await tenantDb
      .selectFrom('contacts')
      .select(['jid'])
      .where('id', '=', message.contact_id)
      .executeTakeFirst()

    if (contact?.jid) {
      const connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id', 'status'])
        .where('status', '=', 'connected')
        .executeTakeFirst()

      if (connection) {
        try {
          await publishSendReaction(
            companyId,
            connection.id,
            contact.jid,
            message.message_id, // Use WhatsApp message_id
            '', // Empty emoji removes the reaction
            user.id,
            message.from_me // Pass from_me flag
          )
        } catch (error) {
          logger.error({ err: formatError(error) }, 'Failed to remove reaction from WhatsApp')
          // Don't fail the request - the reaction is removed from DB
        }
      }
    }
  }

  return c.json({ success: true })
})
