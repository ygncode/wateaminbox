/**
 * Contact event handlers - contact sync, profile pictures, presence, typing
 */

import {
  extractPhoneFromJid,
  normalizeJid,
  toDbDate,
  toISOString,
} from "@wateaminbox/shared";
import { formatError } from "../../lib/logger.js";
import type {
  ContactEvent,
  PresenceEvent,
  ProfilePictureEvent,
  TypingEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/pusher.js";
import { getTenantConnection } from "../tenant.service.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles contact sync events from history sync
 */
export async function handleContactEvent(event: ContactEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { companyId, connectionId, jid: payload.jid },
    "Contact sync received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Get the connection by ID if provided
    let connection;
    if (connectionId) {
      connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id"])
        .where("id", "=", connectionId)
        .executeTakeFirst();
    }

    if (!connection) {
      // Fallback: get any active connection
      connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id"])
        .where("status", "=", "connected")
        .executeTakeFirst();
    }

    if (!connection) {
      logger.warn({ companyId }, "No active connection for company");
      return;
    }

    // Normalize JID to remove device suffix
    const contactJid = normalizeJid(payload.jid);

    // Check if contact already exists
    const existingContact = await tenantDb
      .selectFrom("contacts")
      .select(["id"])
      .where("jid", "=", contactJid)
      .executeTakeFirst();

    if (existingContact) {
      // Update existing contact
      await tenantDb
        .updateTable("contacts")
        .set({
          push_name: payload.displayName || payload.name || null,
          is_group: payload.isGroup,
          profile_picture_url: payload.profilePictureUrl || null,
          updated_at: toDbDate(),
        })
        .where("id", "=", existingContact.id)
        .execute();

      logger.debug({ jid: contactJid, companyId }, "Updated contact");
    } else {
      // Create new contact
      const contactId = crypto.randomUUID();
      // Extract phone number from JID (removes device suffix like ":3")
      const phoneNumber = extractPhoneFromJid(contactJid);
      await tenantDb
        .insertInto("contacts")
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
        .execute();

      logger.debug({ jid: contactJid, companyId }, "Created contact");
    }

    // Broadcast to clients with connectionId
    await broadcastToCompany(companyId, "contact:profile_picture", payload, connectionId);
  } catch (error) {
    logger.error(formatError(error), "Failed to handle contact event");
  }
}

/**
 * Handles profile picture update events
 */
export async function handleProfilePictureEvent(
  event: ProfilePictureEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { companyId, connectionId, jid: payload.jid },
    "Profile picture update",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Normalize JID to match how contacts are stored (without device suffix)
    const contactJid = normalizeJid(payload.jid);

    // Update contact profile picture
    const profilePictureUrl = payload.remove ? null : payload.profilePictureUrl;

    const result = await tenantDb
      .updateTable("contacts")
      .set({
        profile_picture_url: profilePictureUrl,
        updated_at: toDbDate(),
      })
      .where("jid", "=", contactJid)
      .executeTakeFirst();

    if (result.numUpdatedRows > 0) {
      logger.debug(
        {
          jid: contactJid,
          rowsAffected: result.numUpdatedRows.toString(),
        },
        "Updated profile picture for contact",
      );

      // Broadcast to clients with normalized JID
      await broadcastToCompany(
        companyId,
        "contact:profile_picture",
        {
          jid: contactJid,
          profilePictureUrl,
        },
        connectionId,
      );
    } else {
      logger.warn(
        { jid: contactJid },
        "Contact not found for profile picture update",
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle profile picture event");
  }
}

/**
 * Handles presence (online/offline status) events from WhatsApp
 * Updates contact status in database and broadcasts to WebSocket clients
 */
export async function handlePresenceEvent(event: PresenceEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  const isOnline = !payload.unavailable;
  logger.debug(
    { companyId, connectionId, from: payload.from, isOnline },
    "Presence event received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Normalize JID to match how contacts are stored (without device suffix)
    const contactJid = normalizeJid(payload.from);

    // Determine status and last seen
    const lastSeen = payload.lastSeen ? toDbDate(payload.lastSeen) : null;

    // Update contact presence in database
    const result = await tenantDb
      .updateTable("contacts")
      .set({
        is_online: isOnline,
        last_seen: isOnline ? null : lastSeen, // Only set last_seen when going offline
        updated_at: toDbDate(),
      })
      .where("jid", "=", contactJid)
      .executeTakeFirst();

    if (result.numUpdatedRows > 0) {
      logger.debug(
        {
          from: contactJid,
          isOnline,
          rowsAffected: result.numUpdatedRows.toString(),
        },
        "Updated presence for contact",
      );

      // Broadcast to clients with normalized JID
      await broadcastToCompany(
        companyId,
        isOnline ? "presence:online" : "presence:offline",
        {
          jid: contactJid,
          isOnline,
          lastSeen: lastSeen ? toISOString(lastSeen) : undefined,
        },
        connectionId,
      );
    } else {
      // Contact not found - this is normal for contacts we haven't seen messages from yet
      // Don't log a warning as this is expected behavior
      logger.debug(
        { from: contactJid },
        "Presence update for unknown contact - will be created when first message arrives",
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle presence event");
  }
}

/**
 * Handles typing indicator events from WhatsApp
 * Broadcasts directly to WebSocket clients without storing in database
 * (typing state is ephemeral and doesn't need persistence)
 */
export async function handleTypingEvent(event: TypingEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    {
      companyId,
      connectionId,
      from: payload.from,
      isTyping: payload.isTyping,
    },
    "Typing event received",
  );

  // Broadcast to clients
  // Frontend expects conversationId (JID) to match against active chat
  await broadcastToCompany(
    companyId,
    payload.isTyping ? "typing:start" : "typing:stop",
    {
      conversationId: payload.chatJid || payload.from,
      userId: payload.from,
      userName: payload.from, // JID as fallback, could lookup contact name
    },
    connectionId,
  );
}
