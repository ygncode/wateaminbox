import type { JetStreamSubscription } from 'nats'
import {
  subscribeToAllEvents,
  type WhatsAppEvent,
  type QREvent,
  type ConnectionEvent,
  type MessageEvent,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type StatusEvent,
  type ContactEvent,
  type ProfilePictureEvent,
  type MessageRevokeEvent,
  type PresenceEvent,
  type TypingEvent,
  type ReactionEvent,
  type DownloadResponseEvent,
  type SyncStatusEvent,
} from '../lib/nats/index.js'
import { db, type MessageType } from '@whatsapp-web/database'
import { toDbDate, toDate, toISOString, extractPhoneFromJid, normalizeJid } from '@whatsapp-web/shared'
import { getTenantConnection } from './tenant.service.js'
import { updateConnectionStatus } from './whatsapp.service.js'
import { broadcastToCompany } from '../routes/ws.js'
import { updateMessageSearchVector } from './search.service.js'
import { indexMessage, type MessageDocument } from './meilisearch.service.js'
import { createNotification } from './notification-history.service.js'
import { createLogger, formatError } from '../lib/logger.js'

const logger = createLogger('MessageHandler')

// Subscription handle
let eventSubscription: JetStreamSubscription | null = null
let isInitialized = false

/**
 * Initializes the message event handler
 * Subscribes to NATS WhatsApp events and processes them
 * Retries if streams don't exist yet (orchestrator may not have started)
 */
export async function initializeMessageHandler(): Promise<void> {
  if (isInitialized) {
    logger.info('Already initialized')
    return
  }

  const maxRetries = 10
  const retryDelayMs = 3000

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      eventSubscription = await subscribeToAllEvents(handleWhatsAppEvent)
      isInitialized = true
      logger.info('Initialized and subscribed to WhatsApp events')
      return
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isStreamNotFound = errorMessage.includes('no stream matches subject')

      if (isStreamNotFound && attempt < maxRetries) {
        logger.info(
          { attempt, maxRetries, retryDelaySeconds: retryDelayMs / 1000 },
          'Streams not ready, retrying...'
        )
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      } else {
        logger.error(formatError(error), 'Failed to initialize')
        throw error
      }
    }
  }
}

/**
 * Shuts down the message event handler
 */
export async function shutdownMessageHandler(): Promise<void> {
  if (eventSubscription) {
    eventSubscription.unsubscribe()
    eventSubscription = null
  }
  isInitialized = false
  logger.info('Shutdown complete')
}

/**
 * Handles incoming WhatsApp events from NATS
 * Exported for testing purposes
 */
export async function handleWhatsAppEvent(event: WhatsAppEvent): Promise<void> {
  const { type, companyId, connectionId } = event

  logger.debug(
    { type, companyId, connectionId: connectionId || 'unknown' },
    'Received WhatsApp event'
  )

  try {
    switch (type) {
      case 'qr':
        await handleQREvent(event as QREvent)
        break

      case 'connected':
        await handleConnectedEvent(event as ConnectionEvent)
        break

      case 'disconnected':
        await handleDisconnectedEvent(event as ConnectionEvent)
        break

      case 'message':
        await handleMessageEvent(event as MessageEvent)
        break

      case 'receipt':
        await handleReceiptEvent(event as ReceiptEvent)
        break

      case 'send_confirmation':
        await handleSendConfirmationEvent(event as SendConfirmationEvent)
        break

      case 'status':
        await handleStatusEvent(event as StatusEvent)
        break

      case 'contact':
        await handleContactEvent(event as ContactEvent)
        break

      case 'profile_picture':
        await handleProfilePictureEvent(event as ProfilePictureEvent)
        break

      case 'message_revoke':
        await handleMessageRevokeEvent(event as MessageRevokeEvent)
        break

      case 'presence':
        await handlePresenceEvent(event as PresenceEvent)
        break

      case 'typing':
        await handleTypingEvent(event as TypingEvent)
        break

      case 'reaction':
        await handleReactionEvent(event as ReactionEvent)
        break

      case 'download_response':
        await handleDownloadResponseEvent(event as DownloadResponseEvent)
        break

      case 'sync_status':
        await handleSyncStatusEvent(event as SyncStatusEvent)
        break

      case 'error':
        await handleErrorEvent(event)
        break

      default:
        logger.warn({ type }, 'Unknown event type')
    }
  } catch (error) {
    logger.error({ ...formatError(error), type }, 'Error processing event')
  }
}

/**
 * Handles QR code events
 */
async function handleQREvent(event: QREvent): Promise<void> {
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
async function handleConnectedEvent(event: ConnectionEvent): Promise<void> {
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
async function handleDisconnectedEvent(event: ConnectionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.info({ companyId, connectionId, reason: payload.reason }, 'WhatsApp disconnected')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Update connection status in database with connectionId
    await updateConnectionStatus(tenantDb, 'disconnected', connectionId)

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

/**
 * Handles incoming WhatsApp messages
 */
async function handleMessageEvent(event: MessageEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug({ companyId, connectionId, from: payload.from }, 'Message received')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Get the connection by ID if provided, otherwise get any connected one
    let connection
    if (connectionId) {
      connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id'])
        .where('id', '=', connectionId)
        .executeTakeFirst()
    }

    if (!connection) {
      // Fallback: get any active connection
      connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id'])
        .where('status', '=', 'connected')
        .executeTakeFirst()
    }

    if (!connection) {
      logger.warn({ companyId }, 'No active connection for company')
      return
    }

    // Get or create contact - normalize JID first to remove device suffix
    const rawContactJid = payload.fromMe ? payload.to : payload.from
    const contactJid = normalizeJid(rawContactJid)
    let contact = await tenantDb
      .selectFrom('contacts')
      .select(['id'])
      .where('jid', '=', contactJid)
      .executeTakeFirst()

    if (!contact) {
      const contactId = crypto.randomUUID()
      // Extract phone number from JID (removes device suffix like ":3")
      const phoneNumber = extractPhoneFromJid(contactJid)
      await tenantDb
        .insertInto('contacts')
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: contactJid,
          phone_number: phoneNumber,
          is_group: contactJid.includes('@g.us'),
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .execute()
      contact = { id: contactId }
    }

    // Store the message - also normalize sender_jid
    // Determine media download status based on whether it's a history sync with deferred media
    const hasMediaReference = payload.mediaDirectPath && payload.isHistorySync
    const mediaDownloadStatus = hasMediaReference
      ? 'pending'
      : payload.mediaUrl
        ? 'completed'
        : null

    const messageId = crypto.randomUUID()
    await tenantDb
      .insertInto('messages')
      .values({
        id: messageId,
        whatsapp_connection_id: connection.id,
        contact_id: contact.id,
        message_id: payload.messageId,
        from_me: payload.fromMe,
        sender_jid: normalizeJid(payload.from),
        message_type: payload.messageType as MessageType,
        content: payload.content,
        media_url: payload.mediaUrl || null,
        media_mime_type: payload.mediaType || null,
        media_size: payload.mediaSize || null,
        // Deferred media download fields
        media_direct_path: payload.mediaDirectPath || null,
        media_key: payload.mediaKey ? Buffer.from(payload.mediaKey, 'base64') : null,
        media_file_sha256: payload.mediaFileSha256
          ? Buffer.from(payload.mediaFileSha256, 'base64')
          : null,
        media_file_enc_sha256: payload.mediaFileEncSha256
          ? Buffer.from(payload.mediaFileEncSha256, 'base64')
          : null,
        media_download_status: mediaDownloadStatus,
        quoted_message_id: payload.quotedMessageId || null,
        is_forwarded: false,
        is_starred: false,
        deleted_by_sender: false,
        status: payload.fromMe ? 'sent' : 'delivered',
        timestamp: toDbDate(payload.timestamp),
        created_at: toDbDate(),
      })
      .execute()

    logger.debug({ messageId, companyId }, 'Stored message')

    // Index message for search (run in background, don't block message processing)
    // Get contact name for search indexing
    const contactForSearch = await tenantDb
      .selectFrom('contacts')
      .select(['push_name', 'custom_name', 'jid', 'is_group'])
      .where('id', '=', contact.id)
      .executeTakeFirst()

    const contactName = contactForSearch?.custom_name || contactForSearch?.push_name || null

    // Update PostgreSQL full-text search vector
    updateMessageSearchVector(companyId, messageId).catch((err) => {
      logger.error(formatError(err), 'Failed to update search vector')
    })

    // Index in Meilisearch for better search experience
    const messageDoc: MessageDocument = {
      id: messageId,
      companyId,
      contactId: contact.id,
      contactName,
      contactJid: contactForSearch?.jid || contactJid,
      isGroup: contactForSearch?.is_group || contactJid.includes('@g.us'),
      messageId: payload.messageId,
      content: payload.content || null,
      messageType: payload.messageType || 'text',
      timestamp: toDate(payload.timestamp)?.getTime() || Date.now(),
      fromMe: payload.fromMe,
    }

    indexMessage(companyId, messageDoc).catch((err) => {
      logger.error(formatError(err), 'Failed to index message in Meilisearch')
    })

    // Skip notifications, unread counts, and broadcasts for history sync messages
    // History sync imports hundreds of old messages - we don't want to flood the notification system
    if (payload.isHistorySync) {
      logger.debug(
        { messageId, companyId, contactId: contact.id },
        'Skipping notifications for history sync message'
      )
    }

    // Update conversation_states: increment unread count for incoming messages
    // Skip for history sync messages to avoid inflating unread counts with old messages
    if (!payload.fromMe && !payload.isHistorySync) {
      // Try to update existing conversation_states row
      const updateResult = await tenantDb
        .updateTable('conversation_states')
        .set((eb) => ({
          unread_count: eb('unread_count', '+', 1),
          last_message_at: toDbDate(payload.timestamp),
          last_message_preview: payload.content?.substring(0, 100) || null,
          updated_at: toDbDate(),
        }))
        .where('contact_id', '=', contact.id)
        .executeTakeFirst()

      // If no row exists, create one with unread_count = 1
      if (updateResult.numUpdatedRows === BigInt(0)) {
        await tenantDb
          .insertInto('conversation_states')
          .values({
            contact_id: contact.id,
            unread_count: 1,
            last_message_at: toDbDate(payload.timestamp),
            last_message_preview: payload.content?.substring(0, 100) || null,
          })
          .execute()
      }

      // Create in-app notification for the message (run in background to avoid blocking)
      // Get all users in the company to notify them (from public schema)
      const users = await db
        .selectFrom('company_members')
        .innerJoin('users', 'users.id', 'company_members.user_id')
        .select(['users.id'])
        .where('company_members.company_id', '=', companyId)
        .execute()

      // Create notification for each user
      for (const user of users) {
        createNotification(companyId, {
          userId: user.id,
          notificationType: 'message',
          title: contactName || contactJid.split('@')[0] || 'New Message',
          message: payload.content?.substring(0, 100) || 'New message',
          actionUrl: `/chat/${contact.id}`,
          metadata: {
            contactId: contact.id,
            messageId,
            contactJid,
          },
        }).catch((err) => {
          logger.error(
            { ...formatError(err), userId: user.id },
            'Failed to create notification for user'
          )
        })
      }

      // Broadcast notification update to WebSocket clients
      // Frontend will refetch the actual unread count per user
      broadcastToCompany(companyId, {
        type: 'notification:new',
        payload: {},
        timestamp: event.timestamp,
      })
    }

    // Broadcast to WebSocket clients with proper format for frontend
    // Frontend expects { message: Message, conversationId: string }
    // Skip for history sync messages to avoid flooding WebSocket during initial sync
    if (!payload.isHistorySync) {
      broadcastToCompany(companyId, {
        type: 'message:new',
        connectionId,
        payload: {
          message: {
            id: messageId,
            conversationId: contact.id,
            senderId: payload.from,
            senderType: payload.fromMe ? 'user' : 'contact',
            content: payload.content || '',
            messageType: payload.messageType || 'text',
            status: payload.fromMe ? 'sent' : 'delivered',
            whatsappMessageId: payload.messageId,
            metadata: payload.mediaUrl ? { mediaUrl: payload.mediaUrl } : undefined,
            replyToMessageId: payload.quotedMessageId,
            isForwarded: false,
            isDeleted: false,
            isStarred: false,
            createdAt: payload.timestamp,
            updatedAt: payload.timestamp,
          },
          conversationId: contact.id,
        },
        timestamp: event.timestamp,
      })
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to store message')
  }
}

/**
 * Maps WhatsApp receipt types to database message_status enum values
 * WhatsApp types: "sender", "delivered", "read", "played", ""
 * DB enum: "pending", "sent", "delivered", "read", "failed"
 */
function mapReceiptStatus(waStatus: string): 'sent' | 'delivered' | 'read' | null {
  switch (waStatus) {
    case 'sender':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'read':
    case 'played':
      return 'read'
    default:
      // Unknown or empty status - skip update
      return null
  }
}

/**
 * Handles message receipt/status updates
 */
async function handleReceiptEvent(event: ReceiptEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug(
    { status: payload.status, messageId: payload.messageId, connectionId },
    'Receipt received'
  )

  // Map WhatsApp receipt type to database enum
  const dbStatus = mapReceiptStatus(payload.status)
  if (!dbStatus) {
    logger.debug({ status: payload.status }, 'Skipping unknown receipt status')
    return
  }

  try {
    const tenantDb = getTenantConnection(companyId)

    // Update message status in database and return the message info
    // Note: We store the WhatsApp message ID in message_id column
    const updatedMessage = await tenantDb
      .updateTable('messages')
      .set({
        status: dbStatus,
      })
      .where('message_id', '=', payload.messageId)
      .returning(['id', 'contact_id'])
      .executeTakeFirst()

    logger.debug(
      {
        status: dbStatus,
        waMessageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      'Updated message status'
    )

    // Broadcast to WebSocket clients with correct message:status format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      broadcastToCompany(companyId, {
        type: 'message:status',
        connectionId,
        payload: {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: dbStatus,
        },
        timestamp: event.timestamp,
      })
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle receipt')
  }
}

/**
 * Handles send confirmation events
 * Updates a message from pending status with its real WhatsApp message ID
 */
async function handleSendConfirmationEvent(event: SendConfirmationEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug(
    {
      pendingMessageId: payload.pendingMessageId,
      messageId: payload.messageId,
      connectionId,
    },
    'Send confirmation received'
  )

  try {
    const tenantDb = getTenantConnection(companyId)

    // Update the message with the real WhatsApp ID and set status to sent
    // Also return the updated message to get internal ID and contact_id
    const updatedMessage = await tenantDb
      .updateTable('messages')
      .set({
        message_id: payload.messageId,
        status: 'sent',
      })
      .where('message_id', '=', payload.pendingMessageId)
      .returning(['id', 'contact_id'])
      .executeTakeFirst()

    logger.debug(
      {
        pendingMessageId: payload.pendingMessageId,
        messageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      'Updated message with real ID'
    )

    // Broadcast to WebSocket clients with the correct payload format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      broadcastToCompany(companyId, {
        type: 'message:status',
        connectionId,
        payload: {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: 'sent',
        },
        timestamp: event.timestamp,
      })
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle send confirmation')
  }
}

/**
 * Handles WhatsApp status updates
 */
async function handleStatusEvent(event: StatusEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug({ companyId, connectionId, fromJid: payload.fromJid }, 'Status update received')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Get the connection by ID if provided
    let connection
    if (connectionId) {
      connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id'])
        .where('id', '=', connectionId)
        .executeTakeFirst()
    }

    if (!connection) {
      // Fallback: get any active connection
      connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id'])
        .where('status', '=', 'connected')
        .executeTakeFirst()
    }

    if (!connection) {
      logger.warn({ companyId }, 'No active connection for company')
      return
    }

    // Store the status update
    const statusId = crypto.randomUUID()
    await tenantDb
      .insertInto('status_updates')
      .values({
        id: statusId,
        whatsapp_connection_id: connection.id,
        status_id: payload.statusId,
        from_jid: payload.fromJid,
        media_type: payload.mediaType,
        media_url: payload.mediaUrl,
        caption: payload.caption,
        timestamp: toDbDate(payload.timestamp),
        expires_at: toDbDate(payload.expiresAt),
      })
      .execute()

    logger.debug({ statusId, companyId }, 'Stored status update')

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: 'status',
      connectionId,
      payload: {
        id: statusId,
        ...payload,
      },
      timestamp: event.timestamp,
    })
  } catch (error) {
    logger.error(formatError(error), 'Failed to store status')
  }
}

/**
 * Handles contact sync events from history sync
 */
async function handleContactEvent(event: ContactEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug({ companyId, connectionId, jid: payload.jid }, 'Contact sync received')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Get the connection by ID if provided
    let connection
    if (connectionId) {
      connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id'])
        .where('id', '=', connectionId)
        .executeTakeFirst()
    }

    if (!connection) {
      // Fallback: get any active connection
      connection = await tenantDb
        .selectFrom('whatsapp_connections')
        .select(['id'])
        .where('status', '=', 'connected')
        .executeTakeFirst()
    }

    if (!connection) {
      logger.warn({ companyId }, 'No active connection for company')
      return
    }

    // Normalize JID to remove device suffix
    const contactJid = normalizeJid(payload.jid)

    // Check if contact already exists
    const existingContact = await tenantDb
      .selectFrom('contacts')
      .select(['id'])
      .where('jid', '=', contactJid)
      .executeTakeFirst()

    if (existingContact) {
      // Update existing contact
      await tenantDb
        .updateTable('contacts')
        .set({
          push_name: payload.displayName || payload.name || null,
          is_group: payload.isGroup,
          profile_picture_url: payload.profilePictureUrl || null,
          updated_at: toDbDate(),
        })
        .where('id', '=', existingContact.id)
        .execute()

      logger.debug({ jid: contactJid, companyId }, 'Updated contact')
    } else {
      // Create new contact
      const contactId = crypto.randomUUID()
      // Extract phone number from JID (removes device suffix like ":3")
      const phoneNumber = extractPhoneFromJid(contactJid)
      await tenantDb
        .insertInto('contacts')
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: contactJid,
          phone_number: phoneNumber,
          push_name: payload.displayName || payload.name || null,
          is_group: payload.isGroup,
          profile_picture_url: payload.profilePictureUrl || null,
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .execute()

      logger.debug({ jid: contactJid, companyId }, 'Created contact')
    }

    // Broadcast to WebSocket clients with connectionId
    broadcastToCompany(companyId, {
      type: 'contact',
      connectionId,
      payload,
      timestamp: event.timestamp,
    })
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle contact event')
  }
}

/**
 * Handles profile picture update events
 */
async function handleProfilePictureEvent(event: ProfilePictureEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug({ companyId, connectionId, jid: payload.jid }, 'Profile picture update')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Normalize JID to match how contacts are stored (without device suffix)
    const contactJid = normalizeJid(payload.jid)

    // Update contact profile picture
    const profilePictureUrl = payload.remove ? null : payload.profilePictureUrl

    const result = await tenantDb
      .updateTable('contacts')
      .set({
        profile_picture_url: profilePictureUrl,
        updated_at: toDbDate(),
      })
      .where('jid', '=', contactJid)
      .executeTakeFirst()

    if (result.numUpdatedRows > 0) {
      logger.debug(
        {
          jid: contactJid,
          rowsAffected: result.numUpdatedRows.toString(),
        },
        'Updated profile picture for contact'
      )

      // Broadcast to WebSocket clients with normalized JID
      broadcastToCompany(companyId, {
        type: 'contact:profile_picture', // Specific event type for frontend
        connectionId,
        payload: {
          jid: contactJid,
          profilePictureUrl,
        },
        timestamp: event.timestamp,
      })
    } else {
      logger.warn({ jid: contactJid }, 'Contact not found for profile picture update')
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle profile picture event')
  }
}

/**
 * Handles message revoke (deletion) events from WhatsApp
 * When a user deletes a message for everyone, this updates the database
 * and notifies WebSocket clients
 */
async function handleMessageRevokeEvent(event: MessageRevokeEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug({ companyId, connectionId, messageId: payload.messageId }, 'Message revoke received')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Update the message to mark it as deleted by sender
    const result = await tenantDb
      .updateTable('messages')
      .set({
        deleted_by_sender: true,
        deleted_at: toDbDate(),
      })
      .where('message_id', '=', payload.messageId)
      .executeTakeFirst()

    if (result.numUpdatedRows > 0) {
      logger.debug(
        {
          messageId: payload.messageId,
          rowsAffected: result.numUpdatedRows.toString(),
        },
        'Marked message as deleted'
      )

      // Get the message to find the contact_id for broadcasting
      const message = await tenantDb
        .selectFrom('messages')
        .select(['id', 'contact_id'])
        .where('message_id', '=', payload.messageId)
        .executeTakeFirst()

      if (message) {
        // Broadcast to WebSocket clients
        broadcastToCompany(companyId, {
          type: 'message:deleted',
          connectionId,
          payload: {
            messageId: message.id,
            conversationId: message.contact_id,
            whatsappMessageId: payload.messageId,
          },
          timestamp: event.timestamp,
        })
      }
    } else {
      // Message not found - this could happen if:
      // 1. The message was never stored in our database (race condition)
      // 2. The message was already deleted
      // Log a warning but don't throw - this is expected in some edge cases
      logger.warn(
        { messageId: payload.messageId },
        'Message not found for revoke - may be race condition or never stored'
      )
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle message revoke')
    // Don't throw - we want to continue processing other events
  }
}

/**
 * Handles presence (online/offline status) events from WhatsApp
 * Updates contact status in database and broadcasts to WebSocket clients
 */
async function handlePresenceEvent(event: PresenceEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  const isOnline = !payload.unavailable
  logger.debug({ companyId, connectionId, from: payload.from, isOnline }, 'Presence event received')

  try {
    const tenantDb = getTenantConnection(companyId)

    // Normalize JID to match how contacts are stored (without device suffix)
    const contactJid = normalizeJid(payload.from)

    // Determine status and last seen
    const lastSeen = payload.lastSeen ? toDbDate(payload.lastSeen) : null

    // Update contact presence in database
    const result = await tenantDb
      .updateTable('contacts')
      .set({
        is_online: isOnline,
        last_seen: isOnline ? null : lastSeen, // Only set last_seen when going offline
        updated_at: toDbDate(),
      })
      .where('jid', '=', contactJid)
      .executeTakeFirst()

    if (result.numUpdatedRows > 0) {
      logger.debug(
        {
          from: contactJid,
          isOnline,
          rowsAffected: result.numUpdatedRows.toString(),
        },
        'Updated presence for contact'
      )

      // Broadcast to WebSocket clients with normalized JID
      broadcastToCompany(companyId, {
        type: isOnline ? 'presence:online' : 'presence:offline',
        connectionId,
        payload: {
          jid: contactJid,
          isOnline,
          lastSeen: lastSeen ? toISOString(lastSeen) : undefined,
        },
        timestamp: event.timestamp,
      })
    } else {
      // Contact not found - this is normal for contacts we haven't seen messages from yet
      // Don't log a warning as this is expected behavior
      logger.debug(
        { from: contactJid },
        'Presence update for unknown contact - will be created when first message arrives'
      )
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle presence event')
  }
}

/**
 * Handles typing indicator events from WhatsApp
 * Broadcasts directly to WebSocket clients without storing in database
 * (typing state is ephemeral and doesn't need persistence)
 */
async function handleTypingEvent(event: TypingEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug(
    {
      companyId,
      connectionId,
      from: payload.from,
      isTyping: payload.isTyping,
    },
    'Typing event received'
  )

  // Broadcast to WebSocket clients
  // Frontend will match the "from" JID to the active conversation
  broadcastToCompany(companyId, {
    type: payload.isTyping ? 'typing:start' : 'typing:stop',
    connectionId,
    payload: {
      jid: payload.from,
      chatJid: payload.chatJid,
      mediaType: payload.mediaType || 'text',
    },
    timestamp: event.timestamp,
  })
}

/**
 * Handles reaction events from WhatsApp
 * Stores reactions in database and broadcasts to WebSocket clients
 */
async function handleReactionEvent(event: ReactionEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug(
    {
      companyId,
      from: payload.from,
      emoji: payload.emoji || '(removed)',
      messageId: payload.messageId,
    },
    'Reaction event received'
  )

  try {
    // Get database connection
    const tenantDb = getTenantConnection(companyId)

    // Find the message being reacted to (by WhatsApp message_id field, not the internal id)
    const message = await tenantDb
      .selectFrom('messages')
      .select(['id', 'contact_id'])
      .where('message_id', '=', payload.messageId)
      .executeTakeFirst()

    if (!message) {
      logger.warn({ messageId: payload.messageId }, 'Message not found for reaction')
      return
    }

    if (payload.emoji) {
      // Add or update reaction
      await tenantDb
        .insertInto('message_reactions')
        .values({
          message_id: message.id, // Use internal message ID for FK
          reactor_jid: payload.from,
          emoji: payload.emoji,
        })
        .onConflict((oc) =>
          oc.columns(['message_id', 'reactor_jid']).doUpdateSet({
            emoji: payload.emoji,
          })
        )
        .execute()
    } else {
      // Remove reaction (empty emoji)
      await tenantDb
        .deleteFrom('message_reactions')
        .where('message_id', '=', message.id) // Use internal message ID
        .where('reactor_jid', '=', payload.from)
        .execute()
    }

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: 'message:reaction',
      connectionId,
      payload: {
        messageId: message.id, // Use internal message ID
        contactId: message.contact_id, // Use contact_id instead of conversationId
        from: payload.from,
        emoji: payload.emoji,
        timestamp: payload.timestamp,
      },
      timestamp: event.timestamp,
    })
  } catch (error) {
    logger.error(formatError(error), 'Error handling reaction event')
  }
}

/**
 * Handles download response events from the Go download handler
 * Updates message with downloaded media URL and broadcasts to WebSocket clients
 */
async function handleDownloadResponseEvent(event: DownloadResponseEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.info(
    {
      companyId,
      connectionId,
      messageId: payload.messageId,
      success: payload.success,
      mediaUrl: payload.mediaUrl ? payload.mediaUrl.substring(0, 50) + '...' : undefined,
    },
    'Download response received from Go service'
  )

  try {
    const tenantDb = getTenantConnection(companyId)

    if (payload.success && payload.mediaUrl) {
      // Update message with downloaded media
      const updatedMessage = await tenantDb
        .updateTable('messages')
        .set({
          media_url: payload.mediaUrl,
          media_size: payload.mediaSize || null,
          media_download_status: 'completed',
          media_downloaded_at: toDbDate(),
        })
        .where('id', '=', payload.messageId)
        .returning(['id', 'contact_id'])
        .executeTakeFirst()

      if (updatedMessage) {
        logger.info(
          {
            messageId: payload.messageId,
            mediaUrl: payload.mediaUrl,
          },
          'Media download completed'
        )

        // Broadcast to WebSocket clients
        broadcastToCompany(companyId, {
          type: 'media:downloaded',
          connectionId,
          payload: {
            messageId: updatedMessage.id,
            conversationId: updatedMessage.contact_id,
            mediaUrl: payload.mediaUrl,
            mediaSize: payload.mediaSize,
          },
          timestamp: event.timestamp,
        })
      }
    } else {
      // Update message with error status
      await tenantDb
        .updateTable('messages')
        .set({
          media_download_status: 'failed',
          media_download_error: payload.error || 'Unknown error',
        })
        .where('id', '=', payload.messageId)
        .execute()

      logger.error(
        {
          messageId: payload.messageId,
          error: payload.error,
        },
        'Media download failed'
      )

      // Broadcast failure to WebSocket clients
      const message = await tenantDb
        .selectFrom('messages')
        .select(['id', 'contact_id'])
        .where('id', '=', payload.messageId)
        .executeTakeFirst()

      if (message) {
        broadcastToCompany(companyId, {
          type: 'media:download_failed',
          connectionId,
          payload: {
            messageId: message.id,
            conversationId: message.contact_id,
            error: payload.error,
          },
          timestamp: event.timestamp,
        })
      }
    }
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle download response')
  }
}

/**
 * Handles sync status events from WhatsApp history sync
 * Updates database sync_status and broadcasts progress to WebSocket clients
 */
async function handleSyncStatusEvent(event: SyncStatusEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.info(
    {
      companyId,
      connectionId,
      status: payload.status,
      messageCount: payload.messageCount,
      conversations: payload.conversations,
    },
    'Sync status event received'
  )

  try {
    const tenantDb = getTenantConnection(companyId)

    // Update database sync_status for starting/completed (not progress to avoid excessive updates)
    if (payload.status === 'starting' || payload.status === 'completed') {
      const dbStatus = payload.status === 'starting' ? 'syncing' : 'completed'

      await tenantDb
        .updateTable('whatsapp_connections')
        .set({
          sync_status: dbStatus,
          updated_at: toDbDate(),
        })
        .where('id', '=', connectionId)
        .execute()

      logger.info(
        {
          connectionId,
          status: dbStatus,
        },
        'Updated connection sync_status'
      )
    }

    // Map NATS status to WebSocket event type
    const wsTypeMap = {
      starting: 'sync:start' as const,
      progress: 'sync:progress' as const,
      completed: 'sync:complete' as const,
    }

    // Broadcast to WebSocket clients
    broadcastToCompany(companyId, {
      type: wsTypeMap[payload.status],
      connectionId,
      payload: {
        messageCount: payload.messageCount,
        conversations: payload.conversations,
      },
      timestamp: event.timestamp,
    })

    logger.debug(
      {
        type: wsTypeMap[payload.status],
        connectionId,
      },
      'Broadcasted sync status to WebSocket clients'
    )
  } catch (error) {
    logger.error(formatError(error), 'Failed to handle sync status event')
  }
}

/**
 * Handles error events from WhatsApp worker
 */
async function handleErrorEvent(event: WhatsAppEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.error({ companyId, connectionId, payload }, 'Error event from WhatsApp worker')

  // Broadcast error to WebSocket clients with connectionId
  broadcastToCompany(companyId, {
    type: 'error',
    connectionId,
    payload,
    timestamp: event.timestamp,
  })
}

/**
 * Gets initialization status
 */
export function isMessageHandlerInitialized(): boolean {
  return isInitialized
}
