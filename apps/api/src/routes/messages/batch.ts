/**
 * Message Batch Routes
 *
 * Routes for batch operations on messages.
 */
import { toDbDate } from '@whatsapp-web/shared'
import { Hono } from 'hono'
import { badRequest } from '../../lib/errors.js'
import { getRouteContext } from '../../middleware/context.js'

// Batch operation limit
const BATCH_LIMIT = 50

export const batchRoutes = new Hono()

/**
 * POST /star - Star multiple messages at once
 * Body: { messageIds: string[], star: boolean }
 * Limit: 50 messages per request
 */
batchRoutes.post('/star', async (c) => {
  const { tenantDb } = getRouteContext(c)
  const body = await c.req.json()

  const { messageIds, star = true } = body

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return badRequest(c, 'messageIds array is required')
  }

  if (messageIds.length > BATCH_LIMIT) {
    return badRequest(c, `Maximum ${BATCH_LIMIT} messages per batch request`)
  }

  // Update all messages
  const result = await tenantDb
    .updateTable('messages')
    .set({ is_starred: star })
    .where('id', 'in', messageIds)
    .execute()

  return c.json({
    success: true,
    updated: Number(result[0]?.numUpdatedRows || 0),
    isStarred: star,
  })
})

/**
 * POST /delete - Soft delete multiple messages at once
 * Body: { messageIds: string[] }
 * Limit: 50 messages per request
 */
batchRoutes.post('/delete', async (c) => {
  const { tenantDb } = getRouteContext(c)
  const body = await c.req.json()

  const { messageIds } = body

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return badRequest(c, 'messageIds array is required')
  }

  if (messageIds.length > BATCH_LIMIT) {
    return badRequest(c, `Maximum ${BATCH_LIMIT} messages per batch request`)
  }

  // Soft delete all messages
  const result = await tenantDb
    .updateTable('messages')
    .set({ deleted_at: toDbDate() })
    .where('id', 'in', messageIds)
    .where('deleted_at', 'is', null) // Don't re-delete already deleted messages
    .execute()

  return c.json({
    success: true,
    deleted: Number(result[0]?.numUpdatedRows || 0),
  })
})
