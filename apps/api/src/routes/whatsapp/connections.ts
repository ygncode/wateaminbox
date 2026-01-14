/**
 * WhatsApp Multi-Connection Routes
 *
 * CRUD operations for managing multiple WhatsApp connections per company.
 */
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ConnectionNotFoundError,
  InvalidConnectionStateError,
  MaxConnectionsExceededError,
} from '../../lib/errors.js'
import { createLogger, formatError } from '../../lib/logger.js'
import { rateLimitConfig, rateLimitStore } from '../../lib/rate-limit-store.js'
import { authMiddleware } from '../../middleware/auth.js'
import { createConditionalRateLimiter } from '../../middleware/rate-limit.js'
import { tenantFromHeader } from '../../middleware/tenant.js'
import * as whatsappService from '../../services/whatsapp.service.js'
import { sendMessageSchema } from '../../lib/schemas/index.js'

const logger = createLogger('WhatsAppConnectionRoutes')

// WhatsApp operations rate limiter
const whatsappRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.messaging.whatsapp,
    keyStrategy: 'user',
    keyPrefix: 'whatsapp-ops',
  },
  rateLimitConfig.enabled
)

export const connectionRoutes = new Hono()

/**
 * GET /connections - List all WhatsApp connections
 */
connectionRoutes.get('/', authMiddleware, tenantFromHeader('X-Company-ID'), async (c) => {
  const companyId = c.get('companyId')
  const tenantDb = c.get('tenantDb')

  try {
    const connections = await whatsappService.listConnections(tenantDb)
    const limits = await whatsappService.getConnectionLimits(tenantDb, companyId)

    return c.json({
      success: true,
      data: connections.map((conn, index) => ({
        id: conn.id,
        name: conn.name || conn.phoneNumber || `Connection ${index + 1}`,
        phoneNumber: conn.phoneNumber,
        jid: conn.jid,
        status: conn.status,
        connectedBy: conn.connectedBy,
        connectedAt: conn.connectedAt,
        lastSync: conn.lastSyncAt,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      })),
      meta: {
        total: connections.length,
        limits,
      },
    })
  } catch (error) {
    logger.error({ err: formatError(error) }, 'Failed to list connections')
    throw new HTTPException(500, {
      message: 'Failed to list WhatsApp connections',
    })
  }
})

/**
 * POST /connections - Create a new WhatsApp connection
 */
connectionRoutes.post(
  '/',
  authMiddleware,
  tenantFromHeader('X-Company-ID', 'admin'),
  async (c) => {
    const companyId = c.get('companyId')
    const user = c.get('user')
    const tenantDb = c.get('tenantDb')

    try {
      // Read name from request body
      const body = await c.req.json().catch(() => ({}))
      const name = body.name as string | undefined

      const result = await whatsappService.spawnConnection(tenantDb, companyId, user.id, name)

      return c.json(
        {
          success: true,
          data: {
            id: result.connectionId,
            name: name || null,
            status: 'pending' as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          message: 'Connection initiated. Connect to the WebSocket URL to receive the QR code.',
          websocketUrl: result.wsUrl,
        },
        201
      )
    } catch (error) {
      if (error instanceof MaxConnectionsExceededError) {
        throw new HTTPException(429, {
          message: error.message,
          cause: {
            currentCount: error.currentCount,
            maxAllowed: error.maxAllowed,
          },
        })
      }
      logger.error({ err: formatError(error) }, 'Failed to create WhatsApp connection')
      throw new HTTPException(500, {
        message: 'Failed to create WhatsApp connection',
      })
    }
  }
)

/**
 * GET /connections/:connectionId - Get specific connection details
 */
connectionRoutes.get(
  '/:connectionId',
  authMiddleware,
  tenantFromHeader('X-Company-ID'),
  async (c) => {
    const connectionId = c.req.param('connectionId')
    const tenantDb = c.get('tenantDb')

    try {
      const connection = await whatsappService.getConnection(tenantDb, connectionId)

      return c.json({
        success: true,
        data: {
          id: connection.id,
          phoneNumber: connection.phoneNumber,
          jid: connection.jid,
          status: connection.status,
          connectedBy: connection.connectedBy,
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      })
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message })
      }
      logger.error({ err: formatError(error) }, 'Failed to get connection')
      throw new HTTPException(500, {
        message: 'Failed to get connection details',
      })
    }
  }
)

/**
 * PATCH /connections/:connectionId - Update connection (e.g., rename)
 */
connectionRoutes.patch(
  '/:connectionId',
  authMiddleware,
  tenantFromHeader('X-Company-ID'),
  async (c) => {
    const connectionId = c.req.param('connectionId')
    const tenantDb = c.get('tenantDb')

    try {
      // Verify connection exists
      const connection = await whatsappService.getConnection(tenantDb, connectionId)

      // Note: Name is auto-generated from phone number, not stored separately
      return c.json({
        success: true,
        data: {
          id: connection.id,
          name: connection.phoneNumber || `Connection`,
          phoneNumber: connection.phoneNumber,
          jid: connection.jid,
          status: connection.status,
          connectedAt: connection.connectedAt,
          lastSync: connection.lastSyncAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      })
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message })
      }
      logger.error({ err: formatError(error) }, 'Failed to update connection')
      throw new HTTPException(500, {
        message: 'Failed to update connection',
      })
    }
  }
)

/**
 * DELETE /connections/:connectionId - Delete a connection permanently
 */
connectionRoutes.delete(
  '/:connectionId',
  authMiddleware,
  tenantFromHeader('X-Company-ID', 'admin'),
  async (c) => {
    const companyId = c.get('companyId')
    const connectionId = c.req.param('connectionId')
    const tenantDb = c.get('tenantDb')

    try {
      // First disconnect if connected
      const connection = await whatsappService.getConnection(tenantDb, connectionId)

      if (connection.status === 'connected' || connection.status === 'pending') {
        await whatsappService.killConnection(tenantDb, companyId, connectionId)
      }

      // Delete from database
      await tenantDb.deleteFrom('whatsapp_connections').where('id', '=', connectionId).execute()

      return c.json({
        success: true,
        message: 'Connection deleted successfully',
      })
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message })
      }
      logger.error({ err: formatError(error) }, 'Failed to delete connection')
      throw new HTTPException(500, {
        message: 'Failed to delete connection',
      })
    }
  }
)

/**
 * POST /connections/:connectionId/reconnect - Reconnect a disconnected connection
 */
connectionRoutes.post(
  '/:connectionId/reconnect',
  authMiddleware,
  tenantFromHeader('X-Company-ID'),
  async (c) => {
    const companyId = c.get('companyId')
    const connectionId = c.req.param('connectionId')
    const tenantDb = c.get('tenantDb')

    try {
      // Verify connection exists
      const connection = await whatsappService.getConnection(tenantDb, connectionId)

      // Only allow reconnect for disconnected connections
      if (connection.status === 'connected') {
        throw new HTTPException(400, {
          message: 'Connection is already connected',
        })
      }

      if (connection.status === 'pending') {
        throw new HTTPException(400, {
          message: 'Connection is already pending',
        })
      }

      // Update status to pending
      await tenantDb
        .updateTable('whatsapp_connections')
        .set({
          status: 'pending',
          updated_at: new Date(),
        })
        .where('id', '=', connectionId)
        .execute()

      // Publish spawn command to NATS
      const { publishSpawnCommand } = await import('../../lib/nats/index.js')
      const { env } = await import('../../lib/env.js')
      await publishSpawnCommand(companyId, connectionId, env.DATABASE_URL)

      return c.json({
        success: true,
        message: 'Reconnection initiated',
        websocketUrl: `/ws?company=${companyId}&connection=${connectionId}`,
      })
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message })
      }
      if (error instanceof HTTPException) {
        throw error
      }
      logger.error({ err: formatError(error) }, 'Failed to reconnect')
      throw new HTTPException(500, {
        message: 'Failed to reconnect',
      })
    }
  }
)

/**
 * POST /connections/:connectionId/disconnect - Disconnect specific connection
 */
connectionRoutes.post(
  '/:connectionId/disconnect',
  authMiddleware,
  tenantFromHeader('X-Company-ID', 'admin'),
  async (c) => {
    const companyId = c.get('companyId')
    const connectionId = c.req.param('connectionId')
    const tenantDb = c.get('tenantDb')

    try {
      await whatsappService.killConnection(tenantDb, companyId, connectionId)

      return c.json({
        success: true,
        message: 'WhatsApp disconnection initiated',
        data: {
          connectionId,
        },
      })
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message })
      }
      logger.error({ err: formatError(error) }, 'Failed to disconnect WhatsApp')
      throw new HTTPException(500, {
        message: 'Failed to disconnect WhatsApp',
      })
    }
  }
)

/**
 * POST /connections/:connectionId/send - Send message via specific connection
 */
connectionRoutes.post(
  '/:connectionId/send',
  authMiddleware,
  tenantFromHeader('X-Company-ID'),
  whatsappRateLimiter,
  zValidator('json', sendMessageSchema),
  async (c) => {
    const companyId = c.get('companyId')
    const connectionId = c.req.param('connectionId')
    const user = c.get('user')
    const tenantDb = c.get('tenantDb')
    const input = c.req.valid('json')

    // Validate that mediaUrl is provided for non-text messages
    if (input.messageType !== 'text' && !input.mediaUrl) {
      throw new HTTPException(400, {
        message: `mediaUrl is required for ${input.messageType} messages`,
      })
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
        connectionId
      )

      return c.json({
        success: true,
        data: {
          messageId: result.messageId,
          connectionId,
          status: 'pending',
          message: 'Message queued for sending',
        },
      })
    } catch (error) {
      if (error instanceof InvalidConnectionStateError) {
        throw new HTTPException(400, { message: error.message })
      }
      if (error instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message })
      }
      logger.error({ err: formatError(error) }, 'Failed to send message')
      throw new HTTPException(500, {
        message: 'Failed to send message',
      })
    }
  }
)

/**
 * GET /connections/:connectionId/status - Get specific connection status
 */
connectionRoutes.get(
  '/:connectionId/status',
  authMiddleware,
  tenantFromHeader('X-Company-ID'),
  async (c) => {
    const connectionId = c.req.param('connectionId')
    const tenantDb = c.get('tenantDb')

    try {
      const status = await whatsappService.getConnectionStatus(tenantDb, connectionId)

      return c.json({
        success: true,
        data: {
          connectionId,
          ...status,
        },
      })
    } catch (error) {
      logger.error({ err: formatError(error) }, 'Failed to get connection status')
      throw new HTTPException(500, {
        message: 'Failed to get connection status',
      })
    }
  }
)
