/**
 * Contact event handlers - contact sync, profile pictures, presence, typing
 */

import {
  extractPhoneFromJid,
  formatWhatsAppUsername,
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
import { shouldPublishEphemeralSignal } from "../ephemeral-signal-throttle.js";
import { syncGroupSnapshotWithin } from "../group-sync.service.js";
import { broadcastToContactViewersByJid } from "../message-broadcast.service.js";
import { getTenantConnection } from "../tenant.service.js";
import { lockActiveConnectionForEvent } from "./connection-event-guard.js";
import { handlerLogger as logger } from "./types.js";

function isRedactedContactLabel(value: string | undefined): boolean {
  if (!value) return false;
  const digits = [...value].filter((char) => /\p{N}/u.test(char)).length;
  const redactions = [...value].filter((char) => "∙•·*".includes(char)).length;
  return digits >= 2 && redactions >= 2;
}

function getSyncedContactName(payload: ContactEvent["payload"]): string | null {
  for (const value of [
    payload.fullName,
    payload.firstName,
    payload.businessName,
    payload.pushName,
    payload.displayName,
    payload.name,
  ]) {
    const trimmed = value?.trim();
    if (trimmed && !isRedactedContactLabel(trimmed)) return trimmed;
  }
  return null;
}

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

    if (!connectionId) {
      logger.error({ companyId }, "Quarantining contact without connection ID");
      return;
    }
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "archived_at"])
      .where("id", "=", connectionId)
      .executeTakeFirst();

    if (!connection || connection.archived_at) {
      logger.error(
        { companyId, connectionId },
        "Quarantining contact for inactive connection",
      );
      return;
    }

    // Normalize JID to remove device suffix
    const contactJid = normalizeJid(payload.jid);

    const syncedName = getSyncedContactName(payload);
    const formattedUsername =
      payload.username === undefined
        ? undefined
        : formatWhatsAppUsername(payload.username, contactJid);
    const username =
      formattedUsername === undefined
        ? undefined
        : (formattedUsername?.slice(1) ?? null);

    const { contactChanged } = await tenantDb
      .transaction()
      .execute(async (trx) => {
        if (!(await lockActiveConnectionForEvent(trx, connection.id))) {
          return { contactChanged: false };
        }

        // Check if contact already exists for this WhatsApp connection.
        const existingContact = await trx
          .selectFrom("contacts")
          .select(["id", "push_name"])
          .where("jid", "=", contactJid)
          .where("whatsapp_connection_id", "=", connection.id)
          .executeTakeFirst();

        let contactChanged = false;
        let contactId = existingContact?.id ?? null;
        if (existingContact) {
          const shouldClearRedactedName =
            !syncedName &&
            isRedactedContactLabel(existingContact.push_name ?? undefined) &&
            [payload.name, payload.displayName].some(
              (value) => value !== undefined,
            );

          await trx
            .updateTable("contacts")
            .set({
              ...(syncedName ? { push_name: syncedName } : {}),
              ...(shouldClearRedactedName ? { push_name: null } : {}),
              ...(username !== undefined ? { username } : {}),
              ...(payload.isGroup !== undefined
                ? { is_group: payload.isGroup }
                : {}),
              ...(payload.profilePictureUrl !== undefined
                ? { profile_picture_url: payload.profilePictureUrl || null }
                : {}),
              updated_at: toDbDate(),
            })
            .where("id", "=", existingContact.id)
            .execute();

          contactChanged = true;
          logger.debug({ jid: contactJid, companyId }, "Updated contact");
        } else if (!payload.nameOnly) {
          // Name-only events may include the entire address book. Do not create an
          // inbox conversation until WhatsApp supplies conversation history.
          contactId = crypto.randomUUID();
          const phoneNumber = extractPhoneFromJid(contactJid);
          const inserted = await trx
            .insertInto("contacts")
            .values({
              id: contactId,
              whatsapp_connection_id: connection.id,
              jid: contactJid,
              phone_number: phoneNumber,
              push_name: syncedName,
              username: username ?? null,
              is_group: payload.isGroup ?? false,
              profile_picture_url: payload.profilePictureUrl || null,
              created_at: toDbDate(),
              updated_at: toDbDate(),
            })
            .onConflict((oc) =>
              oc
                .columns(["whatsapp_connection_id", "jid"])
                .where("whatsapp_connection_id", "is not", null)
                .where("jid", "is not", null)
                .doNothing(),
            )
            .returning("id")
            .executeTakeFirst();

          if (inserted) {
            contactId = inserted.id;
          } else {
            // A message or another history event created this contact after
            // our lookup. Reuse it and apply the sync metadata below.
            const racedContact = await trx
              .selectFrom("contacts")
              .select("id")
              .where("jid", "=", contactJid)
              .where("whatsapp_connection_id", "=", connection.id)
              .executeTakeFirstOrThrow();
            contactId = racedContact.id;
            await trx
              .updateTable("contacts")
              .set({
                ...(syncedName ? { push_name: syncedName } : {}),
                ...(username !== undefined ? { username } : {}),
                ...(payload.isGroup !== undefined
                  ? { is_group: payload.isGroup }
                  : {}),
                ...(payload.profilePictureUrl !== undefined
                  ? { profile_picture_url: payload.profilePictureUrl || null }
                  : {}),
                updated_at: toDbDate(),
              })
              .where("id", "=", contactId)
              .execute();
          }

          contactChanged = true;
          logger.debug({ jid: contactJid, companyId }, "Created contact");
        }

        // A full conversation event carries WhatsApp's unread snapshot. Persist it
        // in the same table used by both sidebar views instead of deriving unread
        // badges from the number of historical incoming messages.
        //
        // Imported history must never open a case or affect either SLA: a
        // newly-created projection row is explicitly seeded `resolved`/case-free
        // (overriding the table's `open` default), and an existing row's
        // status/active_case_id is left untouched on conflict - only the unread
        // snapshot is refreshed, so this can never resurrect or clobber a live
        // case that already opened from a real inbound message.
        if (
          contactId &&
          !payload.nameOnly &&
          payload.unreadCount !== undefined
        ) {
          await trx
            .insertInto("conversation_states")
            .values({
              contact_id: contactId,
              unread_count: Math.max(0, payload.unreadCount),
              status: "resolved",
              updated_at: toDbDate(),
            })
            .onConflict((oc) =>
              oc.column("contact_id").doUpdateSet({
                unread_count: Math.max(0, payload.unreadCount ?? 0),
                updated_at: toDbDate(),
              }),
            )
            .execute();
        }

        // History sync also carries the group title and current participant list.
        // Keep the legacy contacts.push_name copy for chat compatibility, while
        // filling the dedicated group tables used by the Groups tab and details.
        //
        // Delegated rather than written here: the group tables have exactly one
        // writer, so no code path can record a group state WhatsApp has not
        // confirmed (see group-sync.service.ts). It runs on THIS transaction so
        // it stays inside the connection fence taken above - a second
        // transaction could commit group rows for a connection that is being
        // purged, and would not see the contact row this one has yet to commit.
        if (
          contactId &&
          contactJid &&
          !payload.nameOnly &&
          payload.isGroup === true
        ) {
          await syncGroupSnapshotWithin(trx, companyId, connection.id, {
            jid: contactJid,
            ...(syncedName ? { name: syncedName } : {}),
            ...(payload.description !== undefined
              ? { description: payload.description }
              : {}),
            ...(payload.participants
              ? { participants: payload.participants }
              : {}),
            ...(payload.participantCount !== undefined
              ? { participantCount: payload.participantCount }
              : {}),
          });
        }

        return { contactChanged };
      });

    if (
      contactChanged &&
      (Boolean(syncedName) ||
        username !== undefined ||
        (payload.isGroup === true && !payload.nameOnly))
    ) {
      await broadcastToContactViewersByJid(
        companyId,
        contactJid,
        "contact:updated",
        { jid: contactJid, pushName: syncedName, username: username ?? null },
        { connectionId },
      );
    }
    if (payload.profilePictureUrl !== undefined && contactChanged) {
      await broadcastToContactViewersByJid(
        companyId,
        contactJid,
        "contact:profile_picture",
        {
          jid: contactJid,
          mediaAvailable: Boolean(payload.profilePictureUrl),
        },
        { connectionId },
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle contact event");
    throw error;
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

    const updated = await tenantDb.transaction().execute(async (trx) => {
      if (!(await lockActiveConnectionForEvent(trx, connectionId))) return null;
      const result = await trx
        .updateTable("contacts")
        .set({
          profile_picture_url: profilePictureUrl,
          updated_at: toDbDate(),
        })
        .where("jid", "=", contactJid)
        .where("whatsapp_connection_id", "=", connectionId)
        .executeTakeFirst();

      // Group participants may not have a standalone contact conversation. Cache
      // their avatar directly on existing messages so the chat can still render it.
      const messageResult = await trx
        .updateTable("messages")
        .set({ sender_avatar_url: profilePictureUrl })
        .where("sender_jid", "=", contactJid)
        .where("whatsapp_connection_id", "=", connectionId)
        .executeTakeFirst();
      return { result, messageResult };
    });
    if (!updated) return;
    const { result, messageResult } = updated;

    if (result.numUpdatedRows > 0 || messageResult.numUpdatedRows > 0) {
      logger.debug(
        {
          jid: contactJid,
          rowsAffected: (
            result.numUpdatedRows + messageResult.numUpdatedRows
          ).toString(),
        },
        "Updated profile picture for contact or group participant",
      );

      // Broadcast to clients with normalized JID
      await broadcastToContactViewersByJid(
        companyId,
        contactJid,
        "contact:profile_picture",
        {
          jid: contactJid,
          mediaAvailable: Boolean(profilePictureUrl),
        },
        // A group participant may have no contact row of their own; their
        // identity renders inside the group thread, so the viewers of the
        // groups they belong to are the audience.
        { connectionId, includeGroupMemberships: true },
      );
    } else {
      logger.warn(
        { jid: contactJid },
        "Contact not found for profile picture update",
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle profile picture event");
    throw error;
  }
}

/**
 * Handles presence (online/offline status) events from WhatsApp
 * Updates contact status in database and broadcasts to realtime clients
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
      .where("whatsapp_connection_id", "=", connectionId)
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

      // Broadcast to clients with normalized JID.
      // Presence flaps repeatedly while a contact has the chat open; only a
      // change of state is worth republishing. A row was updated by matching
      // this JID, so it is non-null here - the check keeps that explicit
      // rather than coercing a null into the throttle key.
      if (
        contactJid &&
        shouldPublishEphemeralSignal(
          {
            kind: "presence",
            companyId,
            connectionId,
            conversationJid: contactJid,
          },
          isOnline ? "online" : "offline",
        )
      ) {
        await broadcastToContactViewersByJid(
          companyId,
          contactJid,
          isOnline ? "presence:online" : "presence:offline",
          {
            jid: contactJid,
            isOnline,
            lastSeen: lastSeen ? toISOString(lastSeen) : undefined,
          },
          { connectionId },
        );
      }
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
    throw error;
  }
}

/**
 * Handles typing indicator events from WhatsApp
 * Broadcasts directly to realtime clients without storing in database
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

  // A contact typing a sentence emits a stream of identical `typing:start`
  // events. Collapse the repeats; a state CHANGE (start -> stop) always passes,
  // so an indicator can never be left stuck on.
  const typingChatJid = payload.chatJid || payload.from;
  // An event naming no conversation was previously dropped by the fan-out's
  // own `if (!jid) return`. The throttle now runs first and would throw on a
  // missing key, and this handler rethrows into the NATS consumer - so a
  // malformed payload would become a redelivery loop instead of a no-op.
  if (!typingChatJid) return;
  if (
    !shouldPublishEphemeralSignal(
      {
        kind: "typing",
        companyId,
        connectionId,
        conversationJid: typingChatJid,
        actorJid: payload.from,
      },
      payload.isTyping ? "start" : "stop",
    )
  ) {
    return;
  }

  // Broadcast to clients
  // Frontend expects conversationId (JID) to match against active chat
  await broadcastToContactViewersByJid(
    companyId,
    typingChatJid,
    payload.isTyping ? "typing:start" : "typing:stop",
    {
      conversationId: typingChatJid,
      userId: payload.from,
      userName: payload.from, // JID as fallback, could lookup contact name
    },
    { connectionId },
  );
}
