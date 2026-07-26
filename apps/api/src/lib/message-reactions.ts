import { type Kysely, sql } from "kysely";
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

function identityKey(connectionId: string | null, jid: string): string {
  return `${connectionId || "unknown"}:${normalizeJid(jid)}`;
}

function formatCanonicalJid(jid: string): string | null {
  const normalized = normalizeJid(jid);
  if (!normalized.endsWith("@s.whatsapp.net")) return null;
  const phone = normalized.split("@")[0];
  return /^\d+$/.test(phone) ? `+${phone}` : null;
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
    ...new Set(reactions.map((reaction) => normalizeJid(reaction.reactor_jid))),
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

  // Reactions in first-sync history commonly use private LIDs while contacts
  // and group members already use phone-number JIDs. Load those mappings first
  // so every following identity query includes both forms.
  const lidMappings =
    connectionIds.length > 0
      ? await sql<{
          connection_id: string;
          original_jid: string;
          canonical_jid: string;
        }>`
          SELECT
            connection_id::text AS connection_id,
            regexp_replace(lid, ':[0-9]+@', '@') AS original_jid,
            regexp_replace(jid, ':[0-9]+@', '@') AS canonical_jid
          FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id::text IN (${sql.join(
            connectionIds.map((connectionId) => sql`${connectionId}`),
          )})
            AND regexp_replace(lid, ':[0-9]+@', '@') IN (${sql.join(
              reactorJids.map((jid) => sql`${jid}`),
            )})
        `.execute(tenantDb)
      : { rows: [] };
  const identityJids = [
    ...new Set([
      ...reactorJids,
      ...lidMappings.rows.map((mapping) => mapping.canonical_jid),
    ]),
  ];

  const [contacts, participantMessages, connections, storedIdentities] =
    await Promise.all([
      tenantDb
        .selectFrom("contacts")
        .select([
          "whatsapp_connection_id",
          "jid",
          "phone_number",
          "push_name",
          "custom_name",
          "profile_picture_url",
        ])
        .where("jid", "in", identityJids)
        .execute(),
      contactIds.length > 0
        ? tenantDb
            .selectFrom("messages")
            .select([
              "whatsapp_connection_id",
              "sender_jid",
              "sender_name",
              "sender_avatar_url",
              "timestamp",
            ])
            .where("contact_id", "in", contactIds)
            .where("sender_jid", "in", identityJids)
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
      connectionIds.length > 0
        ? sql<{
            connection_id: string;
            original_jid: string;
            canonical_jid: string;
            name: string | null;
          }>`
          SELECT DISTINCT ON (
            stored.connection_id,
            regexp_replace(stored.their_jid, ':[0-9]+@', '@')
          )
            stored.connection_id::text AS connection_id,
            regexp_replace(their_jid, ':[0-9]+@', '@') AS original_jid,
            regexp_replace(
              coalesce(mapping.jid, their_jid),
              ':[0-9]+@',
              '@'
            ) AS canonical_jid,
            coalesce(
              nullif(full_name, ''),
              nullif(push_name, ''),
              nullif(first_name, ''),
              nullif(business_name, '')
            ) AS name
          FROM whatsapp_sessions.whatsmeow_contacts AS stored
          LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS mapping
            ON mapping.connection_id::text = stored.connection_id::text
            AND regexp_replace(mapping.lid, ':[0-9]+@', '@') =
                regexp_replace(stored.their_jid, ':[0-9]+@', '@')
          WHERE stored.connection_id::text IN (${sql.join(
            connectionIds.map((connectionId) => sql`${connectionId}`),
          )})
            AND (
              regexp_replace(their_jid, ':[0-9]+@', '@') IN (${sql.join(
                identityJids.map((jid) => sql`${jid}`),
              )})
              OR regexp_replace(
                coalesce(mapping.jid, their_jid),
                ':[0-9]+@',
                '@'
              ) IN (${sql.join(identityJids.map((jid) => sql`${jid}`))})
            )
          ORDER BY stored.connection_id, original_jid
        `.execute(tenantDb)
        : Promise.resolve({ rows: [] }),
    ]);

  const identities = new Map<string, ReactorIdentity>();

  // Latest participant message wins because it is most likely to contain the
  // participant's current WhatsApp push name and profile picture.
  for (const participant of participantMessages) {
    if (!participant.sender_jid) continue;
    const key = identityKey(
      participant.whatsapp_connection_id,
      participant.sender_jid,
    );
    if (!identities.has(key)) {
      identities.set(key, {
        name: participant.sender_name,
        avatarUrl: participant.sender_avatar_url,
      });
    }
  }

  // WhatsApp's persisted contact store includes address-book names for group
  // members that never had a standalone inbox conversation. Keep both their
  // original LID and canonical phone JID as aliases.
  const jidAliases: Array<{
    connectionId: string;
    originalJid: string;
    canonicalJid: string;
  }> = lidMappings.rows.map((mapping) => ({
    connectionId: mapping.connection_id,
    originalJid: mapping.original_jid,
    canonicalJid: mapping.canonical_jid,
  }));
  for (const stored of storedIdentities.rows) {
    const canonicalKey = identityKey(
      stored.connection_id,
      stored.canonical_jid,
    );
    const originalKey = identityKey(stored.connection_id, stored.original_jid);
    const current = identities.get(canonicalKey);
    const identity = {
      name: stored.name || current?.name || null,
      avatarUrl: current?.avatarUrl || null,
    };
    identities.set(canonicalKey, identity);
    identities.set(originalKey, identity);
    jidAliases.push({
      connectionId: stored.connection_id,
      originalJid: stored.original_jid,
      canonicalJid: stored.canonical_jid,
    });
  }

  // Saved contact names take precedence over WhatsApp push names.
  for (const contact of contacts) {
    if (!contact.jid) continue;
    const key = identityKey(contact.whatsapp_connection_id, contact.jid);
    identities.set(key, {
      name:
        contact.custom_name ||
        contact.push_name ||
        contact.phone_number ||
        identities.get(key)?.name ||
        null,
      avatarUrl:
        contact.profile_picture_url || identities.get(key)?.avatarUrl || null,
    });
  }

  // Re-apply aliases after saved contacts override the canonical identity.
  for (const alias of jidAliases) {
    const canonical = identities.get(
      identityKey(alias.connectionId, alias.canonicalJid),
    );
    if (canonical) {
      identities.set(
        identityKey(alias.connectionId, alias.originalJid),
        canonical,
      );
    }
  }

  const canonicalJidByAlias = new Map(
    jidAliases.map((alias) => [
      identityKey(alias.connectionId, alias.originalJid),
      normalizeJid(alias.canonicalJid),
    ]),
  );
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
    const reactorKey = identityKey(
      message?.whatsapp_connection_id ?? null,
      reaction.reactor_jid,
    );
    const canonicalReactorJid =
      canonicalJidByAlias.get(reactorKey) || normalizeJid(reaction.reactor_jid);
    const identity =
      identities.get(reactorKey) ||
      identities.get(
        identityKey(
          message?.whatsapp_connection_id ?? null,
          canonicalReactorJid,
        ),
      );
    const existing = reactionsMap.get(reaction.message_id) || [];

    existing.push({
      emoji: reaction.emoji,
      reactorJid: reaction.reactor_jid,
      reactorPhoneNumber: formatCanonicalJid(canonicalReactorJid),
      reactorName: identity?.name || null,
      reactorAvatarUrl: identity?.avatarUrl || null,
      isOwn: ownJid === canonicalReactorJid,
      createdAt: reaction.created_at,
    });
    reactionsMap.set(reaction.message_id, existing);
  }

  return reactionsMap;
}
