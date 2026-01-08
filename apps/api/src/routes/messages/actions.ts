/**
 * Message Action Routes
 *
 * Routes for individual message actions: star, delete.
 */
import { toDbDate } from '@whatsapp-web/shared'
import { Hono } from 'hono'
import { notFound } from '../../lib/errors.js'
import { getRouteContext } from '../../middleware/context.js'

export const actionRoutes = new Hono()

/**
 * POST /:id/star - Star a message
 */
actionRoutes.post('/:id/star', async (c) => {
  const { tenantDb } = getRouteContext(c)
  const messageId = c.req.param('id')

  const updated = await tenantDb
    .updateTable('messages')
    .set({ is_starred: true })
    .where('id', '=', messageId)
    .returning(['id', 'is_starred'])
    .executeTakeFirst()

  if (!updated) {
    return notFound(c, 'Message')
  }

  return c.json({ success: true, isStarred: true })
})

/**
 * DELETE /:id/star - Unstar a message
 */
actionRoutes.delete('/:id/star', async (c) => {
  const { tenantDb } = getRouteContext(c)
  const messageId = c.req.param('id')

  const updated = await tenantDb
    .updateTable('messages')
    .set({ is_starred: false })
    .where('id', '=', messageId)
    .returning(['id', 'is_starred'])
    .executeTakeFirst()

  if (!updated) {
    return notFound(c, 'Message')
  }

  return c.json({ success: true, isStarred: false })
})

/**
 * DELETE /:id - Soft delete a message
 */
actionRoutes.delete('/:id', async (c) => {
  const { tenantDb } = getRouteContext(c)
  const messageId = c.req.param('id')

  const updated = await tenantDb
    .updateTable('messages')
    .set({ deleted_at: toDbDate() })
    .where('id', '=', messageId)
    .returning(['id', 'deleted_at'])
    .executeTakeFirst()

  if (!updated) {
    return notFound(c, 'Message')
  }

  return c.json({
    success: true,
    message: { id: updated.id, deletedAt: updated.deleted_at },
  })
})
