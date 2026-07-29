import { toDbDate } from "@wateaminbox/shared";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  ConnectionNotFoundError,
  DuplicateWhatsAppPhoneError,
  WhatsAppIdentityMismatchError,
} from "../../lib/errors.js";
import type { TenantDatabase } from "../tenant.service.js";
import { normalizeWhatsAppPhone } from "./status.js";

export type TenantExecutor =
  | Kysely<TenantDatabase>
  | Transaction<TenantDatabase>;

export interface ResolvedWhatsAppSession {
  sessionId: string;
  connectionId: string;
  status: string;
}

export async function createConnectionSession(
  executor: TenantExecutor,
  connectionId: string,
  userId: string,
  expectedPhoneNumber?: string | null,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  await executor
    .insertInto("whatsapp_connection_sessions")
    .values({
      id: sessionId,
      whatsapp_connection_id: connectionId,
      status: "pending",
      created_by: userId,
      expected_phone_number: expectedPhoneNumber
        ? normalizeWhatsAppPhone(expectedPhoneNumber)
        : null,
      started_at: toDbDate(),
      created_at: toDbDate(),
      updated_at: toDbDate(),
    })
    .execute();
  return sessionId;
}

export async function resolveWhatsAppSession(
  executor: TenantExecutor,
  sessionId: string,
): Promise<ResolvedWhatsAppSession | null> {
  const session = await executor
    .selectFrom("whatsapp_connection_sessions")
    .select(["id", "whatsapp_connection_id", "status"])
    .where("id", "=", sessionId)
    .executeTakeFirst();
  if (!session) return null;
  return {
    sessionId: session.id,
    connectionId: session.whatsapp_connection_id,
    status: session.status,
  };
}

export async function getActiveSessionId(
  executor: TenantExecutor,
  connectionId: string,
): Promise<string> {
  const session = await executor
    .selectFrom("whatsapp_connection_sessions")
    .select("id")
    .where("whatsapp_connection_id", "=", connectionId)
    .where("ended_at", "is", null)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  if (!session) throw new ConnectionNotFoundError(connectionId);
  return session.id;
}

export async function updateSessionStatus(
  executor: TenantExecutor,
  sessionId: string,
  status: "pending" | "connecting" | "connected" | "disconnected" | "ended",
  reason?: string,
): Promise<void> {
  const now = toDbDate();
  let query = executor
    .updateTable("whatsapp_connection_sessions")
    .set({
      status,
      updated_at: now,
      ...(status === "connected"
        ? { connected_at: now, ended_at: null, end_reason: null }
        : {}),
      ...(status === "ended"
        ? { ended_at: now, end_reason: reason ?? "session ended" }
        : {}),
    })
    .where("id", "=", sessionId);
  if (status !== "ended") {
    query = query.where("ended_at", "is", null);
  }
  await query.execute();
}

/**
 * Claim a phone identity for a successfully paired session.
 *
 * A new setup starts with a provisional stable-account row. If the paired
 * phone already belongs to a historical account, move the session to that
 * account and remove the empty provisional row. Contacts/messages remain
 * attached to the historical account, so no duplicate inbox is created.
 */
export async function claimConnectedSession(
  tenantDb: Kysely<TenantDatabase>,
  sessionId: string,
  phoneNumber: string,
  jid?: string,
): Promise<{ connectionId: string; mergedFromConnectionId: string | null }> {
  const normalizedPhone = normalizeWhatsAppPhone(phoneNumber);

  return tenantDb.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedPhone}, 1))`.execute(
      trx,
    );

    const session = await trx
      .selectFrom("whatsapp_connection_sessions")
      .select(["id", "whatsapp_connection_id", "expected_phone_number"])
      .where("id", "=", sessionId)
      .forUpdate()
      .executeTakeFirst();
    if (!session) throw new ConnectionNotFoundError(sessionId);
    if (
      session.expected_phone_number &&
      session.expected_phone_number !== normalizedPhone
    ) {
      throw new WhatsAppIdentityMismatchError(
        session.expected_phone_number,
        normalizedPhone,
      );
    }

    const currentConnectionId = session.whatsapp_connection_id;
    const existing = await trx
      .selectFrom("whatsapp_connections")
      .select(["id", "status", "archived_at"])
      .where("phone_number", "=", normalizedPhone)
      .where("id", "!=", currentConnectionId)
      .forUpdate()
      .executeTakeFirst();

    if (existing && existing.archived_at === null) {
      throw new DuplicateWhatsAppPhoneError(existing.id, normalizedPhone);
    }

    const targetConnectionId = existing?.id ?? currentConnectionId;
    const now = toDbDate();

    if (existing) {
      // Retire any prior credential set before attaching the new pairing.
      await trx
        .updateTable("whatsapp_connection_sessions")
        .set({
          status: "ended",
          ended_at: now,
          end_reason: "replaced by a newly paired session",
          updated_at: now,
        })
        .where("whatsapp_connection_id", "=", existing.id)
        .where("id", "!=", sessionId)
        .where("ended_at", "is", null)
        .execute();

      await trx
        .updateTable("whatsapp_connection_sessions")
        .set({
          whatsapp_connection_id: existing.id,
          status: "connected",
          connected_at: now,
          ended_at: null,
          end_reason: null,
          updated_at: now,
        })
        .where("id", "=", sessionId)
        .execute();

      await trx
        .deleteFrom("whatsapp_connections")
        .where("id", "=", currentConnectionId)
        .execute();
    } else {
      await trx
        .updateTable("whatsapp_connection_sessions")
        .set({
          status: "connected",
          connected_at: now,
          ended_at: null,
          end_reason: null,
          updated_at: now,
        })
        .where("id", "=", sessionId)
        .execute();
    }

    await trx
      .updateTable("whatsapp_connections")
      .set({
        phone_number: normalizedPhone,
        jid: jid ?? null,
        status: "connected",
        connected_at: now,
        qr_code: null,
        qr_expires_at: null,
        archived_at: null,
        updated_at: now,
      })
      .where("id", "=", targetConnectionId)
      .execute();

    return {
      connectionId: targetConnectionId,
      mergedFromConnectionId: existing ? currentConnectionId : null,
    };
  });
}
