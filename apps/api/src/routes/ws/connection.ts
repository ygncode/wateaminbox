import type { ServerMessage } from '@whatsapp-web/shared'
import { createLogger } from '../../lib/logger.js'
import type { WebSocketConnection } from './types.js'

const logger = createLogger('WebSocket:Connection')

// Connection tracking
const connections = new Map<string, Set<WebSocketConnection>>()

/**
 * Adds a WebSocket connection to the tracking map
 */
export function addConnection(companyId: string, ws: WebSocketConnection): void {
  if (!connections.has(companyId)) {
    connections.set(companyId, new Set())
  }
  connections.get(companyId)!.add(ws)
}

/**
 * Removes a WebSocket connection from the tracking map
 */
export function removeConnection(companyId: string, ws: WebSocketConnection): void {
  const companyConnections = connections.get(companyId)
  if (companyConnections) {
    companyConnections.delete(ws)
    if (companyConnections.size === 0) {
      connections.delete(companyId)
    }
  }
}

/**
 * Gets all connections for a company
 */
export function getCompanyConnections(companyId: string): Set<WebSocketConnection> | undefined {
  return connections.get(companyId)
}

/**
 * Gets all connections map
 */
export function getAllConnections(): Map<string, Set<WebSocketConnection>> {
  return connections
}

/**
 * Broadcasts a message to all connections for a company
 */
export function broadcastToCompany(companyId: string, message: ServerMessage): void {
  const companyConnections = connections.get(companyId)
  if (companyConnections) {
    const payload = JSON.stringify(message)
    let sentCount = 0
    for (const ws of companyConnections) {
      if (ws.readyState === 1) {
        // OPEN
        ws.send(payload)
        sentCount++
      }
    }
    if (message.type === 'message:new') {
      logger.debug({ sentCount, companyId }, 'Broadcast message:new to clients')
    }
    if (message.type === 'media:downloaded' || message.type === 'media:download_failed') {
      logger.info(
        { sentCount, companyId, type: message.type, payload: message.payload },
        'Broadcast media event to clients'
      )
    }
    if (message.type === 'qr') {
      logger.debug(
        { sentCount, companyId, connectionId: (message as { connectionId?: string }).connectionId },
        'Broadcast QR code to clients'
      )
    }
  } else {
    if (message.type === 'message:new') {
      logger.debug({ companyId }, 'No active connections for company to broadcast message')
    }
    // Log when no connections exist for QR broadcast
    if (message.type === 'qr') {
      logger.warn({ companyId }, 'No active WebSocket connections for company to broadcast QR code')
    }
  }
}

/**
 * Sends a message to a specific WebSocket
 */
export function sendMessage(ws: WebSocketConnection, message: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message))
  }
}

/**
 * Gets the number of active connections for a company
 */
export function getConnectionCount(companyId: string): number {
  return connections.get(companyId)?.size || 0
}

/**
 * Gets total number of active WebSocket connections
 */
export function getTotalConnectionCount(): number {
  let total = 0
  for (const conns of connections.values()) {
    total += conns.size
  }
  return total
}

/**
 * Gets detailed connection metrics
 */
export function getConnectionMetrics(heartbeatRunning: boolean): {
  totalConnections: number
  companiesConnected: number
  connectionsPerCompany: { companyId: string; connections: number }[]
  heartbeatRunning: boolean
} {
  const connectionsPerCompany: { companyId: string; connections: number }[] = []
  let totalConnections = 0

  for (const [companyId, conns] of connections) {
    const count = conns.size
    totalConnections += count
    connectionsPerCompany.push({ companyId, connections: count })
  }

  return {
    totalConnections,
    companiesConnected: connections.size,
    connectionsPerCompany,
    heartbeatRunning,
  }
}
