import type { Kysely } from "kysely";
import type { TenantDatabase } from "../services/tenant.service.js";
import type { MessageDbRow, ReactionData } from "./message-formatters.js";

type ReactionMessage = Pick<MessageDbRow, "id" | "whatsapp_connection_id"> & {
  contact_id: string | null;
};

interface ReactorIdentity {
  name: string | null;
  avatarUrl: string | null;
}

/**
 * WhatsApp JIDs can include a device suffix (for example, `123:4@s.whatsapp.net`).
 * Treat device and non-device forms as the same person when resolving identities.
 */
function normalizeJid(jid: string): string {
  const [localPart = jid, server] = jid.split("@");
  const normalizedLocalPart = localPart.split(":")[0];
  return server ? `${normalizedLocalPart}@${server}` : normalizedLocalPart;
}

/**
 * Loads reactions and resolves the best available display identity for each
 * reactor. Group participants are resolved from their latest message metadata;
 * regular contacts are resolved from the contacts table.
 */
export async function loadMessageReactions(
  tenantDb: Kysely<TenantDatabase>,
  messages: ReactionMessage[],
): Promise<Map<string, ReactionData[]>> {
  const reactionsMap = new Map<string, ReactionData[]>();
  if (messages.length === 0) return reactionsMap;

  const reactions = await tenantDb
    .selectFrom("message_reactions")
    .select(["message_id", "emoji", "reactor_jid", "created_at"])
    .where(
      "message_id",
      "in",
      messages.map((message) => message.id),
    )
    .orderBy("created_at", "asc")
    .execute();

  if (reactions.length === 0) return reactionsMap;

  const reactorJids = [
    ...new Set(reactions.map((reaction) => reaction.reactor_jid)),
  ];
  const contactIds = [
    ...new Set(
      messages
        .map((message) => message.contact_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const connectionIds = [
    ...new Set(
      messages
        .map((message) => message.whatsapp_connection_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [contacts, participantMessages, connections] = await Promise.all([
    tenantDb
      .selectFrom("contacts")
      .select([
        "jid",
        "phone_number",
        "push_name",
        "custom_name",
        "profile_picture_url",
      ])
      .where("jid", "in", reactorJids)
      .execute(),
    contactIds.length > 0
      ? tenantDb
          .selectFrom("messages")
          .select([
            "sender_jid",
            "sender_name",
            "sender_avatar_url",
            "timestamp",
          ])
          .where("contact_id", "in", contactIds)
          .where("sender_jid", "in", reactorJids)
          .orderBy("timestamp", "desc")
          .execute()
      : Promise.resolve([]),
    connectionIds.length > 0
      ? tenantDb
          .selectFrom("whatsapp_connections")
          .select(["id", "jid"])
          .where("id", "in", connectionIds)
          .execute()
      : Promise.resolve([]),
  ]);

  const identities = new Map<string, ReactorIdentity>();

  // Latest participant message wins because it is most likely to contain the
  // participant's current WhatsApp push name and profile picture.
  for (const participant of participantMessages) {
    if (!participant.sender_jid) continue;
    const key = normalizeJid(participant.sender_jid);
    if (!identities.has(key)) {
      identities.set(key, {
        name: participant.sender_name,
        avatarUrl: participant.sender_avatar_url,
      });
    }
  }

  // Saved contact names take precedence over WhatsApp push names.
  for (const contact of contacts) {
    if (!contact.jid) continue;
    identities.set(normalizeJid(contact.jid), {
      name:
        contact.custom_name ||
        contact.push_name ||
        contact.phone_number ||
        identities.get(normalizeJid(contact.jid))?.name ||
        null,
      avatarUrl:
        contact.profile_picture_url ||
        identities.get(normalizeJid(contact.jid))?.avatarUrl ||
        null,
    });
  }

  const connectionJidsById = new Map(
    connections
      .filter((connection) => connection.jid !== null)
      .map((connection) => [connection.id, normalizeJid(connection.jid!)]),
  );
  const messagesById = new Map(
    messages.map((message) => [message.id, message]),
  );

  for (const reaction of reactions) {
    const message = messagesById.get(reaction.message_id);
    const ownJid = message?.whatsapp_connection_id
      ? connectionJidsById.get(message.whatsapp_connection_id)
      : undefined;
    const identity = identities.get(normalizeJid(reaction.reactor_jid));
    const existing = reactionsMap.get(reaction.message_id) || [];

    existing.push({
      emoji: reaction.emoji,
      reactorJid: reaction.reactor_jid,
      reactorName: identity?.name || null,
      reactorAvatarUrl: identity?.avatarUrl || null,
      isOwn: ownJid === normalizeJid(reaction.reactor_jid),
      createdAt: reaction.created_at,
    });
    reactionsMap.set(reaction.message_id, existing);
  }

  return reactionsMap;
}
