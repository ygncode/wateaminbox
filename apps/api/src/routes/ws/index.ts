import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'
import { createLogger, formatError } from '../../lib/logger.js'
import { authenticateConnection } from './auth.js'
import {
  broadcastToCompany,
  getConnectionCount,
  getConnectionMetrics as getConnectionMetricsInternal,
  getTotalConnectionCount,
  removeConnection,
  sendMessage,
} from './connection.js'
import { handleClientMessage } from './handlers.js'
import { isHeartbeatRunning, shutdownHeartbeat, startHeartbeat } from './heartbeat.js'
import type { WSData, WebSocketConnection } from './types.js'

const logger = createLogger('WebSocket')

// Create Bun WebSocket handler
const { upgradeWebSocket, websocket: honoWebsocket } = createBunWebSocket<WSData>()

// Wrap the websocket handler with null checks to prevent crashes
export const websocket: typeof honoWebsocket = {
  ...honoWebsocket,
  close(ws: Parameters<typeof honoWebsocket.close>[0], code?: number, reason?: string) {
    // Guard against undefined data.events (happens when connection closes before full setup)
    if (ws.data?.events?.onClose) {
      honoWebsocket.close(ws, code, reason)
    } else {
      logger.debug('Connection closed before initialization')
    }
  },
  message(ws: Parameters<typeof honoWebsocket.message>[0], message: string | Buffer) {
    // Guard against undefined data.events
    if (ws.data?.events?.onMessage) {
      honoWebsocket.message(ws, message)
    } else {
      logger.debug('Message received before initialization')
    }
  },
}

// WebSocket route
export const wsRoutes = new Hono()

const wsUpgradeHandler = upgradeWebSocket((c) => {
  // Extract token and company from query params for initial auth
  const token = c.req.query('token')
  const company = c.req.query('company')

  return {
    onOpen: async (_event, ws) => {
      const rawWs = ws.raw as unknown as WebSocketConnection
      const now = Date.now()
      rawWs.data = {
        userId: '',
        companyId: '',
        authenticated: false,
        lastPongReceived: now,
        isAlive: true,
      }

      logger.debug('Client connected')

      // Start heartbeat if not already running
      startHeartbeat()

      // If token and company provided in query, auto-authenticate
      if (token && company) {
        await authenticateConnection(rawWs, token, company)
      } else {
        // Send auth required message
        sendMessage(rawWs, {
          type: 'error',
          payload: {
            message: 'Authentication required. Send auth message with token and companyId.',
          },
          timestamp: new Date().toISOString(),
        })
      }
    },

    onMessage: async (event, ws) => {
      const rawWs = ws.raw as unknown as WebSocketConnection
      const message = typeof event.data === 'string' ? event.data : event.data.toString()

      await handleClientMessage(rawWs, message)
    },

    onClose: (_event, ws) => {
      const rawWs = ws.raw as unknown as WebSocketConnection
      logger.debug('Client disconnected')

      // Remove from connections
      if (rawWs.data.companyId) {
        removeConnection(rawWs.data.companyId, rawWs)
      }
    },

    onError: (error, ws) => {
      logger.error({ err: formatError(error) }, 'WebSocket error')
      const rawWs = ws.raw as unknown as WebSocketConnection

      // Remove from connections
      if (rawWs.data.companyId) {
        removeConnection(rawWs.data.companyId, rawWs)
      }
    },
  }
})

// Support both with and without trailing slash to match ws://localhost:3001/api/ws
wsRoutes.get('/', wsUpgradeHandler)
wsRoutes.get('', wsUpgradeHandler)

/**
 * Gets detailed connection metrics
 */
export function getConnectionMetrics(): ReturnType<typeof getConnectionMetricsInternal> {
  return getConnectionMetricsInternal(isHeartbeatRunning())
}

// Re-export functions that may be used externally
export {
  broadcastToCompany,
  getConnectionCount,
  getTotalConnectionCount,
  isHeartbeatRunning,
  shutdownHeartbeat,
}
export type { WSData, WebSocketConnection }
