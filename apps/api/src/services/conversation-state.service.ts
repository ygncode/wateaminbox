import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

export type ConversationStatus = "open" | "pending" | "resolved";

// Note: This interface matches the conversation_states table from migration 006
// TypeScript types will be fully updated after running `bun run db:generate`
interface ConversationStatesRow {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  resolved_at: Date | null;
  resolved_by: string | null;
  reopened_at: Date | null;
  reopened_by: string | null;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationState {
  id: string;
  contactId: string;
  status: ConversationStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Helper type for database with conversation_states
type DbWithConvStates = Kysely<
  TenantDatabase & { conversation_states: ConversationStatesRow }
>;

// Type casting helper
function castDb(tenantDb: Kysely<TenantDatabase>): DbWithConvStates {
  return tenantDb as unknown as DbWithConvStates;
}

/**
 * Gets the current conversation state for a contact
 */
export async function getConversationState(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationState | null> {
  const db = castDb(tenantDb);
  const state = await db
    .selectFrom("conversation_states")
    .selectAll()
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!state) return null;

  return {
    id: state.id,
    contactId: state.contact_id,
    status: state.status,
    resolvedAt: state.resolved_at,
    resolvedBy: state.resolved_by,
    reopenedAt: state.reopened_at,
    reopenedBy: state.reopened_by,
    resolutionNotes: state.resolution_notes,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}

/**
 * Gets or creates a conversation state for a contact
 */
export async function getOrCreateConversationState(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationState> {
  const existing = await getConversationState(tenantDb, contactId);
  if (existing) return existing;

  const db = castDb(tenantDb);
  const state = await db
    .insertInto("conversation_states")
    .values({
      contact_id: contactId,
      status: "open",
    } as ConversationStatesRow)
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    id: state.id,
    contactId: state.contact_id,
    status: state.status,
    resolvedAt: state.resolved_at,
    resolvedBy: state.resolved_by,
    reopenedAt: state.reopened_at,
    reopenedBy: state.reopened_by,
    resolutionNotes: state.resolution_notes,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}

/**
 * Resolves a conversation
 */
export async function resolveConversation(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string,
  notes?: string,
): Promise<ConversationState> {
  // Ensure conversation state exists
  await getOrCreateConversationState(tenantDb, contactId);

  const db = castDb(tenantDb);
  const state = await db
    .updateTable("conversation_states")
    .set({
      status: "resolved",
      resolved_at: new Date(),
      resolved_by: userId,
      resolution_notes: notes || null,
      updated_at: new Date(),
    })
    .where("contact_id", "=", contactId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    id: state.id,
    contactId: state.contact_id,
    status: state.status,
    resolvedAt: state.resolved_at,
    resolvedBy: state.resolved_by,
    reopenedAt: state.reopened_at,
    reopenedBy: state.reopened_by,
    resolutionNotes: state.resolution_notes,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}

/**
 * Reopens a conversation
 */
export async function reopenConversation(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string,
): Promise<ConversationState> {
  // Ensure conversation state exists
  await getOrCreateConversationState(tenantDb, contactId);

  const db = castDb(tenantDb);
  const state = await db
    .updateTable("conversation_states")
    .set({
      status: "open",
      reopened_at: new Date(),
      reopened_by: userId,
      updated_at: new Date(),
    })
    .where("contact_id", "=", contactId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    id: state.id,
    contactId: state.contact_id,
    status: state.status,
    resolvedAt: state.resolved_at,
    resolvedBy: state.resolved_by,
    reopenedAt: state.reopened_at,
    reopenedBy: state.reopened_by,
    resolutionNotes: state.resolution_notes,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}

/**
 * Sets a conversation to pending status
 */
export async function setConversationPending(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationState> {
  // Ensure conversation state exists
  await getOrCreateConversationState(tenantDb, contactId);

  const db = castDb(tenantDb);
  const state = await db
    .updateTable("conversation_states")
    .set({
      status: "pending",
      updated_at: new Date(),
    })
    .where("contact_id", "=", contactId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    id: state.id,
    contactId: state.contact_id,
    status: state.status,
    resolvedAt: state.resolved_at,
    resolvedBy: state.resolved_by,
    reopenedAt: state.reopened_at,
    reopenedBy: state.reopened_by,
    resolutionNotes: state.resolution_notes,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}

/**
 * Gets resolution statistics for analytics
 */
export interface ResolutionStats {
  totalConversations: number;
  openConversations: number;
  pendingConversations: number;
  resolvedConversations: number;
  resolutionRate: number;
  averageResolutionTimeMinutes: number | null;
}

export async function getResolutionStats(
  tenantDb: Kysely<TenantDatabase>,
): Promise<ResolutionStats> {
  const db = castDb(tenantDb);

  const row = await db
    .selectFrom("conversation_states")
    .select((eb) => [
      eb.fn.countAll().as("total"),
      eb.fn.countAll().filterWhere("status", "=", "open").as("open_count"),
      eb.fn
        .countAll()
        .filterWhere("status", "=", "pending")
        .as("pending_count"),
      eb.fn
        .countAll()
        .filterWhere("status", "=", "resolved")
        .as("resolved_count"),
    ])
    .executeTakeFirst();
  const total = Number(row?.total || 0);
  const open = Number(row?.open_count || 0);
  const pending = Number(row?.pending_count || 0);
  const resolved = Number(row?.resolved_count || 0);

  // Calculate resolution rate as percentage
  const resolutionRate = total > 0 ? (resolved / total) * 100 : 0;

  return {
    totalConversations: total,
    openConversations: open,
    pendingConversations: pending,
    resolvedConversations: resolved,
    resolutionRate: Math.round(resolutionRate * 100) / 100,
    averageResolutionTimeMinutes: null, // Deferred for simplicity
  };
}

/**
 * Gets resolution rate trend over time
 */
export interface ResolutionTrend {
  date: string;
  resolved: number;
  total: number;
  rate: number;
}

export async function getResolutionTrend(
  tenantDb: Kysely<TenantDatabase>,
  startDate: Date,
  endDate: Date,
): Promise<ResolutionTrend[]> {
  const db = castDb(tenantDb);

  // Get resolved conversations grouped by date
  const resolvedResult = await db
    .selectFrom("conversation_states")
    .select((eb) => [
      sql<string>`DATE(resolved_at)`.as("date"),
      eb.fn.countAll().as("count"),
    ])
    .where("status", "=", "resolved")
    .where("resolved_at", ">=", startDate)
    .where("resolved_at", "<=", endDate)
    .groupBy(sql`DATE(resolved_at)`)
    .orderBy("date", "asc")
    .execute();

  // Get total conversations created by date
  const createdResult = await db
    .selectFrom("conversation_states")
    .select((eb) => [
      sql<string>`DATE(created_at)`.as("date"),
      eb.fn.countAll().as("count"),
    ])
    .where("created_at", ">=", startDate)
    .where("created_at", "<=", endDate)
    .groupBy(sql`DATE(created_at)`)
    .execute();

  // Create a map of dates
  const dateMap = new Map<string, { resolved: number; total: number }>();

  // Initialize all dates in range
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split("T")[0];
    dateMap.set(dateStr, { resolved: 0, total: 0 });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Fill in resolved counts
  for (const row of resolvedResult) {
    const dateStr = String(row.date);
    const existing = dateMap.get(dateStr) || { resolved: 0, total: 0 };
    existing.resolved = Number(row.count);
    dateMap.set(dateStr, existing);
  }

  // Fill in total counts
  for (const row of createdResult) {
    const dateStr = String(row.date);
    const existing = dateMap.get(dateStr) || { resolved: 0, total: 0 };
    existing.total = Number(row.count);
    dateMap.set(dateStr, existing);
  }

  // Convert to array with rates
  const trend: ResolutionTrend[] = [];
  for (const [date, counts] of dateMap) {
    trend.push({
      date,
      resolved: counts.resolved,
      total: counts.total,
      rate:
        counts.total > 0
          ? Math.round((counts.resolved / counts.total) * 100)
          : 0,
    });
  }

  return trend.sort((a, b) => a.date.localeCompare(b.date));
}
