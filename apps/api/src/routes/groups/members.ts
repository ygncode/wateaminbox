/**
 * Group Member Routes
 *
 * Routes for managing group participants (promote, demote, remove).
 */
import { Hono } from 'hono'
import { notFound, badRequest, forbidden } from '../../lib/errors.js'
import {
  publishGroupPromoteAdmin,
  publishGroupDemoteAdmin,
  publishGroupRemoveParticipant,
} from '../../lib/nats/index.js'
import { getRouteContext } from '../../middleware/context.js'
import { createAuditLog, getClientIp } from '../../services/audit.service.js'
import { getConnectionJid, isUserGroupAdmin } from './helpers.js'

export const memberRoutes = new Hono()

/**
 * POST /:id/participants/:participantJid/promote - Promote participant to admin
 */
memberRoutes.post('/:id/participants/:participantJid/promote', async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c)
  const userId = user.id
  const contactId = c.req.param('id')
  const participantJid = c.req.param('participantJid')

  // Get group contact
  const contact = await tenantDb
    .selectFrom('contacts')
    .select(['id', 'jid', 'whatsapp_connection_id'])
    .where('id', '=', contactId)
    .where('is_group', '=', true)
    .executeTakeFirst()

  if (!contact || !contact.jid) {
    return notFound(c, 'Group')
  }

  if (!contact.whatsapp_connection_id) {
    return badRequest(c, 'Group is not associated with any WhatsApp connection')
  }

  // Get group details
  const group = await tenantDb
    .selectFrom('groups')
    .select(['id', 'name'])
    .where('contact_id', '=', contactId)
    .executeTakeFirst()

  if (!group) {
    return notFound(c, 'Group details')
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb)
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid)

  if (!isAdmin) {
    return forbidden(c, 'Only group admins can promote participants')
  }

  // Check if participant exists in group
  const participant = await tenantDb
    .selectFrom('group_participants')
    .select(['id', 'is_admin'])
    .where('group_id', '=', group.id)
    .where('participant_jid', '=', participantJid)
    .executeTakeFirst()

  if (!participant) {
    return notFound(c, 'Participant in group')
  }

  if (participant.is_admin) {
    return badRequest(c, 'Participant is already an admin')
  }

  // Update local database
  await tenantDb
    .updateTable('group_participants')
    .set({ is_admin: true })
    .where('id', '=', participant.id)
    .execute()

  // Publish NATS command to WhatsApp service
  await publishGroupPromoteAdmin(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    participantJid,
    userId
  )

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: 'contact.updated',
    entityType: 'group',
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      groupName: group.name,
      participantJid,
      operation: 'promote_admin',
    },
    ipAddress: getClientIp(c.req.raw.headers),
  })

  return c.json({
    success: true,
    message: 'Participant promoted to admin',
    participantJid,
  })
})

/**
 * POST /:id/participants/:participantJid/demote - Demote admin to regular participant
 */
memberRoutes.post('/:id/participants/:participantJid/demote', async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c)
  const userId = user.id
  const contactId = c.req.param('id')
  const participantJid = c.req.param('participantJid')

  // Get group contact
  const contact = await tenantDb
    .selectFrom('contacts')
    .select(['id', 'jid', 'whatsapp_connection_id'])
    .where('id', '=', contactId)
    .where('is_group', '=', true)
    .executeTakeFirst()

  if (!contact || !contact.jid) {
    return notFound(c, 'Group')
  }

  if (!contact.whatsapp_connection_id) {
    return badRequest(c, 'Group is not associated with any WhatsApp connection')
  }

  // Get group details
  const group = await tenantDb
    .selectFrom('groups')
    .select(['id', 'name'])
    .where('contact_id', '=', contactId)
    .executeTakeFirst()

  if (!group) {
    return notFound(c, 'Group details')
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb)
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid)

  if (!isAdmin) {
    return forbidden(c, 'Only group admins can demote participants')
  }

  // Check if participant exists and is admin
  const participant = await tenantDb
    .selectFrom('group_participants')
    .select(['id', 'is_admin'])
    .where('group_id', '=', group.id)
    .where('participant_jid', '=', participantJid)
    .executeTakeFirst()

  if (!participant) {
    return notFound(c, 'Participant in group')
  }

  if (!participant.is_admin) {
    return badRequest(c, 'Participant is not an admin')
  }

  // Update local database
  await tenantDb
    .updateTable('group_participants')
    .set({ is_admin: false })
    .where('id', '=', participant.id)
    .execute()

  // Publish NATS command to WhatsApp service
  await publishGroupDemoteAdmin(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    participantJid,
    userId
  )

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: 'contact.updated',
    entityType: 'group',
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      groupName: group.name,
      participantJid,
      operation: 'demote_admin',
    },
    ipAddress: getClientIp(c.req.raw.headers),
  })

  return c.json({
    success: true,
    message: 'Admin demoted to regular participant',
    participantJid,
  })
})

/**
 * DELETE /:id/participants/:participantJid - Remove participant from group
 */
memberRoutes.delete('/:id/participants/:participantJid', async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c)
  const userId = user.id
  const contactId = c.req.param('id')
  const participantJid = c.req.param('participantJid')

  // Get group contact
  const contact = await tenantDb
    .selectFrom('contacts')
    .select(['id', 'jid', 'whatsapp_connection_id'])
    .where('id', '=', contactId)
    .where('is_group', '=', true)
    .executeTakeFirst()

  if (!contact || !contact.jid) {
    return notFound(c, 'Group')
  }

  if (!contact.whatsapp_connection_id) {
    return badRequest(c, 'Group is not associated with any WhatsApp connection')
  }

  // Get group details
  const group = await tenantDb
    .selectFrom('groups')
    .select(['id', 'name', 'participant_count'])
    .where('contact_id', '=', contactId)
    .executeTakeFirst()

  if (!group) {
    return notFound(c, 'Group details')
  }

  // Check if current user is admin
  const connectionJid = await getConnectionJid(tenantDb)
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid)

  if (!isAdmin) {
    return forbidden(c, 'Only group admins can remove participants')
  }

  // Check if participant exists
  const participant = await tenantDb
    .selectFrom('group_participants')
    .select(['id'])
    .where('group_id', '=', group.id)
    .where('participant_jid', '=', participantJid)
    .executeTakeFirst()

  if (!participant) {
    return notFound(c, 'Participant in group')
  }

  // Cannot remove yourself
  if (participantJid === connectionJid) {
    return badRequest(c, 'Cannot remove yourself from the group')
  }

  // Remove from local database
  await tenantDb.deleteFrom('group_participants').where('id', '=', participant.id).execute()

  // Update participant count
  await tenantDb
    .updateTable('groups')
    .set({ participant_count: Math.max(0, (group.participant_count || 1) - 1) })
    .where('id', '=', group.id)
    .execute()

  // Publish NATS command to WhatsApp service
  await publishGroupRemoveParticipant(
    companyId,
    contact.whatsapp_connection_id,
    contact.jid,
    participantJid,
    userId
  )

  // Create audit log
  await createAuditLog({
    companyId,
    userId,
    action: 'contact.updated',
    entityType: 'group',
    entityId: contactId,
    details: {
      groupJid: contact.jid,
      groupName: group.name,
      participantJid,
      operation: 'remove_participant',
    },
    ipAddress: getClientIp(c.req.raw.headers),
  })

  return c.json({
    success: true,
    message: 'Participant removed from group',
    participantJid,
  })
})
