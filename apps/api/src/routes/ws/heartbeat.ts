import { createLogger } from '../../lib/logger.js'
import { getAllConnections, removeConnection, sendMessage } from './connection.js'
import type { WebSocketConnection } from './types.js'

const logger = createLogger('WebSocket:Heartbeat')

// Heartbeat configuration
const PING_INTERVAL_MS = 45000 // Send ping every 45 seconds
const PONG_TIMEOUT_MS = 15000 // Close connection if no pong within 15 seconds

// Heartbeat interval reference
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Sends a ping to a specific WebSocket for heartbeat
 */
function sendPing(ws: WebSocketConnection): void {
  if (ws.readyState === 1) {
    // Use WebSocket protocol-level ping if available, otherwise send a custom ping message
    try {
      ws.ping()
    } catch {
      // Fallback to application-level ping if protocol ping fails
      sendMessage(ws, {
        type: 'pong', // Server sends "pong" as a ping request (client should respond with "ping")
        timestamp: new Date().toISOString(),
      })
    }
  }
}

/**
 * Starts the server-side heartbeat interval
 * Periodically pings all connections and closes stale ones
 */
export function startHeartbeat(): void {
  if (heartbeatIntervalId) {
    return // Already running
  }

  logger.info('Starting server-side heartbeat')

  heartbeatIntervalId = setInterval(() => {
    const now = Date.now()
    let pingsSent = 0
    let staleConnections = 0
    const connections = getAllConnections()

    for (const [companyId, companyConnections] of connections) {
      for (const ws of companyConnections) {
        // Check if this connection has timed out
        if (!ws.data.isAlive && now - ws.data.lastPongReceived > PONG_TIMEOUT_MS) {
          // Connection is stale - close it
          logger.warn(
            { companyId, userId: ws.data.userId },
            'Closing stale connection - no heartbeat response'
          )
          staleConnections++
          try {
            ws.close(1001, 'Connection timed out - no heartbeat response')
          } catch {
            // Ignore close errors
          }
          removeConnection(companyId, ws)
          continue
        }

        // Mark as not alive and send ping
        // Will be marked alive again when pong is received
        ws.data.isAlive = false
        sendPing(ws)
        pingsSent++
      }
    }

    if (pingsSent > 0 || staleConnections > 0) {
      logger.debug({ pingsSent, staleConnections }, 'Heartbeat cycle completed')
    }
  }, PING_INTERVAL_MS)
}

/**
 * Stops the server-side heartbeat interval
 */
export function stopHeartbeat(): void {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId)
    heartbeatIntervalId = null
    logger.info('Stopped server-side heartbeat')
  }
}

/**
 * Records a pong response from a client
 */
export function recordPong(ws: WebSocketConnection): void {
  ws.data.isAlive = true
  ws.data.lastPongReceived = Date.now()
}

/**
 * Gracefully shuts down the WebSocket heartbeat
 * Should be called during server shutdown
 */
export function shutdownHeartbeat(): void {
  stopHeartbeat()
}

/**
 * Checks if the heartbeat is currently running
 */
export function isHeartbeatRunning(): boolean {
  return heartbeatIntervalId !== null
}
