/**
 * Connection event handlers - QR code, connected, disconnected
 */

import type { QREvent, ConnectionEvent } from '../../lib/nats/index.js'
import { toDbDate } from '@whatsapp-web/shared'
import { getTenantConnection } from '../tenant.service.js'
import { updateConnectionStatus } from '../whatsapp.service.js'
import { broadcastToCompany } from '../../routes/ws/index.js'
import { formatError } from '../../lib/logger.js'
import { handlerLogger as logger } from './types.js'

/**
 * Handles QR code events
 */
export async function handleQREvent(event: QREvent): Promise<void> {
  const { companyId, connectionId } = event

  // QR events are handled by WebSocket broadcast
  // Just log for monitoring
  logger.info({ companyId, connectionId }, 'QR code generated')

  // Broadcast to connected WebSocket clients with connectionId
  broadcastToCompany(companyId, {
    type: 'qr',
    connectionId,
    payload: event.payload,
    timestamp: event.timestamp,
  })
}

/**
 * Handles WhatsApp connection established events
 */
export async function handleConnectedEvent(event: ConnectionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.info({ companyId, connectionId, phoneNumber: payload.phoneNumber }, 'WhatsApp connected')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Update connection status in database with connectionId
    await updateConnectionStatus(
      tenantDb,
      'connected',
      connectionId,
      payload.phoneNumber,
      payload.jid
    )

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: 'connected',
      connectionId,
      payload: {
        phoneNumber: payload.phoneNumber,
        jid: payload.jid,
      },
      timestamp: event.timestamp,
    })
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle connected event')
  }
}

/**
 * Handles WhatsApp disconnection events
 */
export async function handleDisconnectedEvent(event: ConnectionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.info({ companyId, connectionId, reason: payload.reason }, 'WhatsApp disconnected')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Check if sync was in progress before disconnection
    const connection = await tenantDb
      .selectFrom('whatsapp_connections')
      .select(['sync_status'])
      .where('id', '=', connectionId)
      .executeTakeFirst()

    const wasSyncing = connection?.sync_status === 'syncing'

    // Update connection status in database with connectionId
    await updateConnectionStatus(tenantDb, 'disconnected', connectionId)

    // If sync was interrupted, update sync_status to "interrupted"
    if (wasSyncing) {
      await tenantDb
        .updateTable('whatsapp_connections')
        .set({
          sync_status: 'interrupted',
          updated_at: toDbDate(),
        })
        .where('id', '=', connectionId)
        .execute()

      logger.info({ connectionId }, 'History sync was interrupted by disconnection')

      // Broadcast sync interrupted event
      broadcastToCompany(companyId, {
        type: 'sync:interrupted',
        connectionId,
        payload: {
          reason: payload.reason,
        },
        timestamp: event.timestamp,
      })
    }

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: 'disconnected',
      connectionId,
      payload: {
        reason: payload.reason,
      },
      timestamp: event.timestamp,
    })
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle disconnected event')
  }
}
