import { db } from "@wateaminbox/database";
import { createLogger, formatError } from "../lib/logger.js";
import { getTenantConnection } from "./tenant.service.js";

const logger = createLogger("Audit");

/**
 * Audit log action types
 */
export type AuditAction =
  | "user.login"
  | "user.logout"
  | "invitation.sent"
  | "invitation.accepted"
  | "invitation.cancelled"
  | "invitation.resent"
  | "member.role_changed"
  | "member.removed"
  | "contact.created"
  | "contact.updated"
  | "contact.assigned"
  | "contact.unassigned"
  | "contact.blocked"
  | "contact.unblocked"
  | "contact.note.created"
  | "contact.note.updated"
  | "contact.note.deleted"
  | "message.sent"
  | "message.deleted"
  | "bulk_job.created"
  | "bulk_job.canceled"
  | "bulk_job.completed"
  | "tag.created"
  | "tag.deleted"
  | "company.updated"
  | "connection.archived"
  | "connection.relinked"
  | "connection.purged"
  | "conversation.resolved"
  | "conversation.opened"
  | "conversation.reopened"
  | "conversation.pending"
  | "conversation.resumed";

/**
 * Audit log entry
 */
export interface AuditActor {
  id: string;
  name: string | null;
  email: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
  actor: AuditActor | null;
}

/**
 * Input for creating an audit log
 */
export interface CreateAuditLogInput {
  companyId: string;
  userId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Creates an audit log entry
 */
export async function createAuditLog(
  input: CreateAuditLogInput,
): Promise<void> {
  try {
    const tenantDb = getTenantConnection(input.companyId);

    await tenantDb
      .insertInto("audit_logs")
      .values({
        user_id: input.userId,
        action: input.action,
        entity_type: input.entityType || null,
        entity_id: input.entityId || null,
        details: input.details || null,
        ip_address: input.ipAddress || null,
      })
      .execute();
  } catch (error) {
    // Log error but don't throw - audit logging shouldn't break main functionality
    logger.error(
      { err: formatError(error), action: input.action },
      "Failed to create audit log",
    );
  }
}

/**
 * Query parameters for fetching audit logs
 */
export interface GetAuditLogsParams {
  companyId: string;
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Gets audit logs with optional filters
 */
export async function getAuditLogs(params: GetAuditLogsParams): Promise<{
  logs: AuditLog[];
  total: number;
}> {
  const tenantDb = getTenantConnection(params.companyId);
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  let query = tenantDb
    .selectFrom("audit_logs")
    .selectAll()
    .orderBy("created_at", "desc");

  // Apply filters
  if (params.userId) {
    query = query.where("user_id", "=", params.userId);
  }

  if (params.action) {
    query = query.where("action", "=", params.action);
  }

  if (params.entityType) {
    query = query.where("entity_type", "=", params.entityType);
  }

  if (params.entityId) {
    query = query.where("entity_id", "=", params.entityId);
  }

  if (params.startDate) {
    query = query.where("created_at", ">=", params.startDate);
  }

  if (params.endDate) {
    query = query.where("created_at", "<=", params.endDate);
  }

  // Get paginated results
  const logs = await query.limit(limit).offset(offset).execute();

  // Get total count
  let countQuery = tenantDb
    .selectFrom("audit_logs")
    .select((eb) => eb.fn.count("id").as("total"));

  if (params.userId) {
    countQuery = countQuery.where("user_id", "=", params.userId);
  }
  if (params.action) {
    countQuery = countQuery.where("action", "=", params.action);
  }
  if (params.entityType) {
    countQuery = countQuery.where("entity_type", "=", params.entityType);
  }
  if (params.entityId) {
    countQuery = countQuery.where("entity_id", "=", params.entityId);
  }
  if (params.startDate) {
    countQuery = countQuery.where("created_at", ">=", params.startDate);
  }
  if (params.endDate) {
    countQuery = countQuery.where("created_at", "<=", params.endDate);
  }

  const countResult = await countQuery.executeTakeFirst();
  const total = Number(countResult?.total || 0);

  const actorIds = [
    ...new Set(
      logs.map((log) => log.user_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const actors = actorIds.length
    ? await db
        .selectFrom("users")
        .select(["id", "name", "email"])
        .where("id", "in", actorIds)
        .execute()
    : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  return {
    logs: logs.map((log) => ({
      id: log.id,
      userId: log.user_id,
      action: log.action as AuditAction,
      entityType: log.entity_type,
      entityId: log.entity_id,
      details: log.details as Record<string, unknown> | null,
      ipAddress: log.ip_address,
      createdAt: log.created_at,
      actor: log.user_id ? (actorById.get(log.user_id) ?? null) : null,
    })),
    total,
  };
}

/** Actors are resolved independently of Team-management permission. */
export async function getAuditActors(companyId: string): Promise<AuditActor[]> {
  const tenantDb = getTenantConnection(companyId);
  const actorRows = await tenantDb
    .selectFrom("audit_logs")
    .select("user_id")
    .distinct()
    .where("user_id", "is not", null)
    .execute();
  const actorIds = actorRows
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  if (!actorIds.length) return [];

  const actors = await db
    .selectFrom("users")
    .select(["id", "name", "email"])
    .where("id", "in", actorIds)
    .orderBy("email", "asc")
    .execute();

  return actors.map((actor) => ({
    id: actor.id,
    name: actor.name,
    email: actor.email,
  }));
}

/**
 * Helper to get client IP from request
 */
export function getClientIp(headers: Headers): string | undefined {
  return (
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip") ||
    undefined
  );
}
