/**
 * WhatsApp Connection Management Module
 *
 * Handles listing, creating, and managing WhatsApp connections.
 * Supports multiple connections per company with configurable limits.
 */

import { db, type WhatsAppConnectionStatus } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  ConnectionNotArchivedError,
  ConnectionNotFoundError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
import {
  enqueueConnectionCommand,
  enqueueSessionCommand,
} from "../command-outbox.service.js";
import type { TenantDatabase } from "../tenant.service.js";
import {
  createConnectionSession,
  getActiveSessionId,
  updateSessionStatus,
} from "./session.js";

export async function archiveConnectionWithUnlink(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  connectionId: string,
  enqueueKill: typeof enqueueConnectionCommand = enqueueConnectionCommand,
): Promise<boolean> {
  const connection = await trx
    .selectFrom("whatsapp_connections")
    .select(["id", "status", "archived_at"])
    .where("id", "=", connectionId)
    .forUpdate()
    .executeTakeFirst();
  if (!connection) return false;
  if (connection.archived_at) return false;

  const sessionId = await getActiveSessionId(trx, connectionId);
  await enqueueKill(trx, companyId, connectionId, (publisher) =>
    publisher.kill("connection archived and unlinked", true),
  );
  const now = toDbDate();
  await trx
    .updateTable("whatsapp_connections")
    .set({
      status: "disconnected",
      qr_code: null,
      qr_expires_at: null,
      archived_at: now,
      updated_at: now,
    })
    .where("id", "=", connectionId)
    .execute();
  await updateSessionStatus(
    trx,
    sessionId,
    "ended",
    "connection archived and unlinked",
  );
  return true;
}

/** @deprecated Use archiveConnectionWithUnlink. */
export const deleteConnectionWithKill = archiveConnectionWithUnlink;

export interface ArchivedConnectionPurge {
  /**
   * Every erased contact id. The Meilisearch contact documents are keyed by
   * it, and the message documents are filterable by it.
   */
  contactIds: string[];
  deletedMessageCount: number;
  /**
   * Bulk jobs that lost recipients to the purge. A job whose remaining leaves
   * have all settled can no longer be finalized by the dispatcher (nothing is
   * left to dispatch), so the caller has to settle it once, after commit.
   */
  affectedBulkJobIds: string[];
}

/**
 * Permanently delete a previously archived account and all inbox data owned by
 * it. This is deliberately separate from archive/unlink.
 *
 * Everything commits in one transaction, in an order that satisfies the tenant
 * schema's foreign keys:
 *
 *   - `conversation_cases.opening_message_id` references `messages`, so cases
 *     must go BEFORE the messages they were opened by. Deleting them also
 *     clears `messages.case_id` and `conversation_states.active_case_id`
 *     (both ON DELETE SET NULL) for rows this purge is about to delete anyway.
 *   - `conversation_cases.contact_id` cascades from `contacts`, so contacts
 *     must go AFTER their messages - otherwise the cascade would try to remove
 *     a case still guarding an undeleted opening message.
 *   - `whatsapp_labels`/`whatsapp_catalogs`/`catalog_products`/
 *     `whatsapp_connection_sessions` cascade from `whatsapp_connections`, but
 *     are deleted explicitly so the erased set is stated here rather than
 *     inferred from schema history.
 *
 * Every statement is scoped to this connection or to contacts owned by it, so
 * a sibling connection in the same workspace keeps all of its data.
 *
 * Deliberately NOT erased:
 *   - `tags`, `quick_replies` and other workspace-level records: they are
 *     shared with every other connection, so removing them would delete data
 *     the operator did not ask to lose. Only this connection's `contact_tags`
 *     links and its synced `whatsapp_labels` rows go.
 *   - `bulk_jobs` parents: a broadcast's audience can span connections. Only
 *     the leaves addressed to purged contacts are removed.
 *   - `audit_logs`: the record of what happened to this workspace has to
 *     outlive the data it describes (this purge writes one of its own).
 *   - `nats_outbox`: an archived connection's last queued command is the
 *     unlink itself. Dropping it undelivered would leave the phone still
 *     linked to a device nobody can reach.
 * Stored media objects and search documents are erased through durable cleanup
 * items inserted by this same transaction. This keeps an unbounded object set
 * out of API memory without losing retryability after the source rows vanish.
 */
export async function purgeArchivedConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
): Promise<ArchivedConnectionPurge> {
  return tenantDb.transaction().execute(async (trx) => {
    const connection = await trx
      .selectFrom("whatsapp_connections")
      .select(["id", "archived_at"])
      .where("id", "=", connectionId)
      .forUpdate()
      .executeTakeFirst();
    if (!connection) throw new ConnectionNotFoundError(connectionId);
    if (!connection.archived_at) throw new ConnectionNotArchivedError();

    // Subqueries, not materialized id lists: a busy account can hold millions
    // of messages, and only the contact ids (bounded by the address book) are
    // ever pulled into memory - the search index needs them after commit.
    const contactIds = trx
      .selectFrom("contacts")
      .select("id")
      .where("whatsapp_connection_id", "=", connectionId);
    const messageIds = trx
      .selectFrom("messages")
      .select("id")
      .where("whatsapp_connection_id", "=", connectionId);
    const groupIds = trx
      .selectFrom("groups")
      .select("id")
      .where("contact_id", "in", contactIds);
    const contactRows = await trx
      .selectFrom("contacts")
      .select("id")
      .where("whatsapp_connection_id", "=", connectionId)
      .forUpdate()
      .execute();
    const bulkProgressRows = await trx
      .selectFrom("scheduled_messages")
      .select(["bulk_job_id", "status"])
      .select((eb) => eb.fn.countAll().as("count"))
      .where("contact_id", "in", contactIds)
      .where("bulk_job_id", "is not", null)
      .groupBy(["bulk_job_id", "status"])
      .execute();
    const affectedBulkJobIds = [
      ...new Set(
        bulkProgressRows
          .map((row) => row.bulk_job_id)
          .filter((id): id is string => id !== null),
      ),
    ];

    // The source rows are about to disappear, so retain enough durable work to
    // remove their external representations after commit. INSERT .. SELECT
    // keeps even very large media histories inside PostgreSQL rather than
    // materializing every URL in the API process.
    await trx
      .insertInto("purge_cleanup_items")
      .columns(["connection_id", "kind", "reference"])
      .expression((eb) =>
        eb
          .selectFrom("contacts")
          .select([
            eb.val(connectionId).as("connection_id"),
            eb.val("search_contact" as const).as("kind"),
            sql<string>`id::text`.as("reference"),
          ])
          .where("whatsapp_connection_id", "=", connectionId),
      )
      .onConflict((oc) =>
        oc.columns(["connection_id", "kind", "reference"]).doNothing(),
      )
      .execute();
    for (const source of [
      { table: "messages" as const, column: "media_url" as const },
      { table: "messages" as const, column: "sender_avatar_url" as const },
      { table: "contacts" as const, column: "profile_picture_url" as const },
      { table: "status_updates" as const, column: "media_url" as const },
      {
        table: "whatsapp_catalogs" as const,
        column: "header_image_url" as const,
      },
      { table: "scheduled_messages" as const, column: "media_url" as const },
    ]) {
      // DISTINCT matters: an avatar or profile picture repeats on every row
      // that carries it, so without it this inserts one candidate per message
      // instead of one per object.
      let mediaQuery = trx
        .selectFrom(source.table)
        .select([
          sql<string>`${connectionId}::uuid`.as("connection_id"),
          sql<"media">`'media'`.as("kind"),
          sql<string>`${sql.ref(source.column)}`.as("reference"),
        ])
        .distinct()
        .where(source.column, "is not", null);
      // Schedules are reached through their contact; every other source is
      // owned by the connection directly.
      mediaQuery =
        source.table === "scheduled_messages"
          ? mediaQuery.where("contact_id", "in", contactIds)
          : mediaQuery.where("whatsapp_connection_id", "=", connectionId);
      await trx
        .insertInto("purge_cleanup_items")
        .columns(["connection_id", "kind", "reference"])
        .expression(mediaQuery)
        .onConflict((oc) =>
          oc.columns(["connection_id", "kind", "reference"]).doNothing(),
        )
        .execute();
    }
    await trx
      .insertInto("purge_cleanup_items")
      .columns(["connection_id", "kind", "reference"])
      .expression((eb) =>
        eb
          .selectFrom("catalog_products")
          .select([
            eb.val(connectionId).as("connection_id"),
            eb.val("media" as const).as("kind"),
            sql<string>`unnest(image_urls)`.as("reference"),
          ])
          .where("whatsapp_connection_id", "=", connectionId)
          .where("image_urls", "is not", null),
      )
      .onConflict((oc) =>
        oc.columns(["connection_id", "kind", "reference"]).doNothing(),
      )
      .execute();
    if (affectedBulkJobIds.length > 0) {
      await trx
        .insertInto("purge_cleanup_items")
        .values(
          affectedBulkJobIds.map((bulkJobId) => ({
            connection_id: connectionId,
            kind: "bulk_job" as const,
            reference: bulkJobId,
          })),
        )
        .onConflict((oc) =>
          oc.columns(["connection_id", "kind", "reference"]).doNothing(),
        )
        .execute();
    }

    // Keep aggregate outcomes honest after privacy deletion removes leaves.
    for (const bulkJobId of affectedBulkJobIds) {
      const counts = {
        sent: 0,
        failed: 0,
        canceled: 0,
        skipped: 0,
      };
      for (const row of bulkProgressRows) {
        if (row.bulk_job_id !== bulkJobId) continue;
        const count = Number(row.count);
        if (row.status === "sent") counts.sent += count;
        else if (row.status === "failed") counts.failed += count;
        else if (row.status === "canceled") counts.canceled += count;
        else counts.skipped += count;
      }
      await trx
        .updateTable("bulk_jobs")
        .set((eb) => ({
          purged_sent: eb("purged_sent", "+", counts.sent),
          purged_failed: eb("purged_failed", "+", counts.failed),
          purged_canceled: eb("purged_canceled", "+", counts.canceled),
          purged_skipped: eb("purged_skipped", "+", counts.skipped),
          updated_at: toDbDate(),
        }))
        .where("id", "=", bulkJobId)
        .execute();
    }

    await trx
      .deleteFrom("message_reactions")
      .where("message_id", "in", messageIds)
      .execute();
    await trx
      .deleteFrom("conversation_cases")
      .where("contact_id", "in", contactIds)
      .execute();
    // A case always opens on a message belonging to its own contact, so the
    // delete above covers every case this connection's messages can be tied
    // to. This releases any link that drifted outside that invariant instead
    // of failing the purge on it - it clears a pointer to a message that is
    // being erased regardless, and leaves the other connection's case intact.
    await trx
      .updateTable("conversation_cases")
      .set({ opening_message_id: null })
      .where("opening_message_id", "in", messageIds)
      .execute();
    await trx
      .deleteFrom("conversation_states")
      .where("contact_id", "in", contactIds)
      .execute();
    // Undelivered schedules and bulk leaves addressed to erased contacts can
    // never dispatch; leaving them would surface "contact no longer exists"
    // failures for a conversation the operator was told is gone.
    await trx
      .deleteFrom("scheduled_messages")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_tags")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_assignments")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_notes_private")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_notes_shared")
      .where("contact_id", "in", contactIds)
      .execute();
    // Notifications carry the contact id they deep-link into; keeping them
    // would leave the inbox advertising conversations that no longer exist.
    await trx
      .deleteFrom("notification_history")
      .where(
        sql<string>`metadata->>'contactId'`,
        "in",
        trx
          .selectFrom("contacts")
          .select(sql<string>`id::text`.as("id"))
          .where("whatsapp_connection_id", "=", connectionId),
      )
      .execute();
    // Pending join requests hang off the group. The foreign key cascades, but
    // the purge deletes every dependent row explicitly so the set it is
    // responsible for stays readable here rather than implied by DDL.
    await trx
      .deleteFrom("group_join_requests")
      .where("group_id", "in", groupIds)
      .execute();
    await trx
      .deleteFrom("group_participants")
      .where("group_id", "in", groupIds)
      .execute();
    await trx.deleteFrom("groups").where("id", "in", groupIds).execute();
    const deletedMessages = await trx
      .deleteFrom("messages")
      .where("whatsapp_connection_id", "=", connectionId)
      .executeTakeFirst();
    await trx
      .deleteFrom("contacts")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("status_updates")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("catalog_products")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("whatsapp_catalogs")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("whatsapp_labels")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("bulk_connection_budgets")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("whatsapp_connection_sessions")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("whatsapp_connections")
      .where("id", "=", connectionId)
      .execute();
    return {
      contactIds: contactRows.map((row) => row.id),
      deletedMessageCount: Number(deletedMessages?.numDeletedRows ?? 0n),
      affectedBulkJobIds,
    };
  });
}

// Default max connections if not specified in company settings
const DEFAULT_MAX_CONNECTIONS = 5;

// Types
export interface WhatsAppConnection {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  jid: string | null;
  status: WhatsAppConnectionStatus;
  connectedBy: string | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  qrCode: string | null;
  qrExpiresAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps database row to WhatsAppConnection interface
 */
function mapConnectionRow(conn: {
  id: string;
  name: string | null;
  phone_number: string | null;
  jid: string | null;
  status: WhatsAppConnectionStatus;
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  qr_code?: string | null;
  qr_expires_at?: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): WhatsAppConnection {
  return {
    id: conn.id,
    name: conn.name,
    phoneNumber: conn.phone_number,
    jid: conn.jid,
    status: conn.status,
    connectedBy: conn.connected_by,
    connectedAt: conn.connected_at,
    lastSyncAt: conn.last_sync_at,
    qrCode: conn.qr_code ?? null,
    qrExpiresAt: conn.qr_expires_at ?? null,
    archivedAt: conn.archived_at,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  };
}

/**
 * Gets the maximum allowed WhatsApp connections for a company
 */
export async function getMaxConnections(companyId: string): Promise<number> {
  const company = await db
    .selectFrom("companies")
    .select(["max_whatsapp_connections"])
    .where("id", "=", companyId)
    .executeTakeFirst();

  return company?.max_whatsapp_connections ?? DEFAULT_MAX_CONNECTIONS;
}

// Pending connection timeout (2 minutes) - if pending longer, mark as disconnected
const PENDING_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Lists all WhatsApp connections for a company
 * Also cleans up stale pending connections (older than 2 minutes)
 */
export async function listConnections(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection[]> {
  // Clean up stale pending connections (pending for more than 2 minutes)
  const staleThreshold = new Date(Date.now() - PENDING_TIMEOUT_MS);
  await tenantDb
    .updateTable("whatsapp_connections")
    .set({
      status: "disconnected",
      qr_code: null,
      qr_expires_at: null,
      updated_at: toDbDate(),
    })
    .where("status", "=", "pending")
    .where("updated_at", "<", staleThreshold)
    .execute();

  const connections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "qr_code",
      "qr_expires_at",
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("archived_at", "is", null)
    .orderBy("created_at", "desc")
    .execute();

  return connections.map(mapConnectionRow);
}

export async function listArchivedConnections(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection[]> {
  const connections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "qr_code",
      "qr_expires_at",
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("archived_at", "is not", null)
    .orderBy("archived_at", "desc")
    .execute();
  return connections.map(mapConnectionRow);
}

export async function relinkArchivedConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  connectionId: string,
  userId: string,
): Promise<void> {
  await tenantDb.transaction().execute(async (trx) => {
    const connection = await trx
      .selectFrom("whatsapp_connections")
      .select(["id", "phone_number", "archived_at"])
      .where("id", "=", connectionId)
      .forUpdate()
      .executeTakeFirst();
    if (!connection) throw new ConnectionNotFoundError(connectionId);
    if (!connection.archived_at) {
      throw new Error("Only archived connections can be linked again");
    }

    const sessionId = await createConnectionSession(
      trx,
      connectionId,
      userId,
      connection.phone_number,
    );
    await trx
      .updateTable("whatsapp_connections")
      .set({
        status: "pending",
        archived_at: null,
        qr_code: null,
        qr_expires_at: null,
        updated_at: toDbDate(),
      })
      .where("id", "=", connectionId)
      .execute();
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.spawn(),
    );
  });
}

/**
 * Gets a specific WhatsApp connection by ID
 */
export async function getConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
): Promise<WhatsAppConnection> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("id", "=", connectionId)
    .executeTakeFirst();

  if (!connection) {
    throw new ConnectionNotFoundError(connectionId);
  }

  return mapConnectionRow(connection);
}

/**
 * Spawns a new WhatsApp connection for a company
 * Creates a pending connection record and publishes spawn command to NATS
 * Supports multiple connections per company up to max_whatsapp_connections limit
 */
export async function spawnConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  userId: string,
  name?: string,
): Promise<{ connectionId: string }> {
  // Get max connections limit for this company
  const maxConnections = await getMaxConnections(companyId);

  // Create a new pending connection record. A company-scoped transaction
  // advisory lock serializes the count+insert sequence across API replicas.
  const connectionId = crypto.randomUUID();

  await tenantDb.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId}, 0))`.execute(
      trx,
    );

    const activeConnections = await trx
      .selectFrom("whatsapp_connections")
      .select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("status", "in", ["connected", "pending"])
      .executeTakeFirst();
    const currentCount = Number(activeConnections?.count ?? 0);
    if (currentCount >= maxConnections) {
      throw new MaxConnectionsExceededError(currentCount, maxConnections);
    }

    await trx
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: name || null,
        status: "pending",
        connected_by: userId,
        created_at: toDbDate(),
        updated_at: toDbDate(),
      })
      .execute();

    const sessionId = await createConnectionSession(trx, connectionId, userId);
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.spawn(),
    );
  });

  return { connectionId };
}

/**
 * Kills/disconnects a specific WhatsApp connection
 */
export async function killConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  connectionId: string,
): Promise<void> {
  // Get connection to verify it exists and is active
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("id", "=", connectionId)
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  if (!connection) {
    throw new ConnectionNotFoundError(connectionId);
  }

  await tenantDb.transaction().execute(async (trx) => {
    const sessionId = await getActiveSessionId(trx, connectionId);
    await trx
      .updateTable("whatsapp_connections")
      .set({
        status: "disconnected",
        qr_code: null,
        qr_expires_at: null,
        updated_at: toDbDate(),
      })
      .where("id", "=", connectionId)
      .execute();

    await updateSessionStatus(trx, sessionId, "disconnected");
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.kill(),
    );
  });
}

/**
 * Gets the first active connection (for backward compatibility)
 */
export async function getActiveConnection(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection | null> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection) {
    return null;
  }

  return mapConnectionRow(connection);
}

/**
 * Gets all active connections for a company
 */
export async function getActiveConnections(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection[]> {
  const connections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("status", "=", "connected")
    .orderBy("created_at", "asc")
    .execute();

  return connections.map(mapConnectionRow);
}

/**
 * Gets connection limits info for a company
 */
export async function getConnectionLimits(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
): Promise<{ current: number; max: number; available: number }> {
  const maxConnections = await getMaxConnections(companyId);

  const activeConnections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(({ fn }) => [fn.count<number>("id").as("count")])
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  const current = Number(activeConnections?.count ?? 0);

  return {
    current,
    max: maxConnections,
    available: Math.max(0, maxConnections - current),
  };
}
