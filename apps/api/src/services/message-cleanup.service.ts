import { db } from "@whatsapp-web/database";
import { sql } from "kysely";
import {
  getCleanupConfig,
  type MessageCleanupConfig,
} from "../config/cleanup.config.js";
import { broadcastToCompany } from "../routes/ws.js";
import { getTenantConnection, tenantSchemaExists } from "./tenant.service.js";

// Re-export the type for consumers of this service
export type { MessageCleanupConfig };

// ============================================================================
// Service State
// ============================================================================

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let isInitialized = false;
let currentConfig: MessageCleanupConfig = getCleanupConfig();

// ============================================================================
// Result Types
// ============================================================================

export interface CompanyCleanupResult {
  companyId: string;
  expiredCount: number;
  error?: string;
}

export interface CleanupCycleResult {
  totalProcessed: number;
  totalExpired: number;
  companies: CompanyCleanupResult[];
  durationMs: number;
  skipped: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the current cleanup configuration
 */
export function getMessageCleanupConfig(): MessageCleanupConfig {
  return { ...currentConfig };
}

/**
 * Update the cleanup configuration at runtime
 */
export function setMessageCleanupConfig(
  updates: Partial<MessageCleanupConfig>,
): MessageCleanupConfig {
  currentConfig = { ...currentConfig, ...updates };
  console.log("[MessageCleanup] Configuration updated:", currentConfig);
  return currentConfig;
}

/**
 * Check if the cleanup service is initialized
 */
export function isMessageCleanupInitialized(): boolean {
  return isInitialized;
}

/**
 * Get the cleanup service status
 */
export function getMessageCleanupStatus(): "running" | "stopped" | "disabled" {
  if (!currentConfig.enabled) return "disabled";
  return isInitialized ? "running" : "stopped";
}

/**
 * Initialize the message cleanup service
 * Starts a periodic interval that cleans up stale pending messages
 */
export async function initializeMessageCleanup(
  config?: Partial<MessageCleanupConfig>,
): Promise<void> {
  if (isInitialized) {
    console.log("[MessageCleanup] Already initialized");
    return;
  }

  // Apply any custom configuration overrides
  if (config) {
    currentConfig = { ...getCleanupConfig(), ...config };
  }

  // Check if cleanup is disabled
  if (!currentConfig.enabled) {
    console.log("[MessageCleanup] Disabled by configuration");
    return;
  }

  console.log("[MessageCleanup] Initializing with config:", currentConfig);

  // Run initial cleanup cycle
  try {
    const result = await runCleanupCycle();
    console.log(
      `[MessageCleanup] Initial cleanup complete: ${result.totalExpired} messages expired across ${result.companies.length} companies`,
    );
  } catch (error) {
    console.error("[MessageCleanup] Initial cleanup failed:", error);
  }

  // Start periodic cleanup cycles
  const intervalMs = currentConfig.intervalMinutes * 60 * 1000;
  cleanupIntervalId = setInterval(async () => {
    try {
      const result = await runCleanupCycle();
      if (result.skipped) {
        console.log(
          `[MessageCleanup] Cleanup cycle skipped (no active companies)`,
        );
      } else {
        console.log(
          `[MessageCleanup] Cleanup cycle complete: ${result.totalExpired} messages expired across ${result.companies.length} companies in ${result.durationMs}ms`,
        );
      }
    } catch (error) {
      console.error("[MessageCleanup] Cleanup cycle failed:", error);
    }
  }, intervalMs);

  isInitialized = true;
  console.log(
    `[MessageCleanup] Initialized and running every ${currentConfig.intervalMinutes} minute(s)`,
  );
}

/**
 * Shutdown the message cleanup service
 * Stops the periodic interval and cleans up resources
 */
export async function shutdownMessageCleanup(): Promise<void> {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  isInitialized = false;
  console.log("[MessageCleanup] Shutdown complete");
}

/**
 * Run a single cleanup cycle
 * Iterates through all active companies and expires stale pending messages
 */
export async function runCleanupCycle(): Promise<CleanupCycleResult> {
  const startTime = Date.now();

  // Check if cleanup is enabled
  if (!currentConfig.enabled) {
    return {
      totalProcessed: 0,
      totalExpired: 0,
      companies: [],
      durationMs: Date.now() - startTime,
      skipped: true,
    };
  }

  // Get all active companies
  const companies = await getActiveCompanies();

  if (companies.length === 0) {
    return {
      totalProcessed: 0,
      totalExpired: 0,
      companies: [],
      durationMs: Date.now() - startTime,
      skipped: true,
    };
  }

  const results: CompanyCleanupResult[] = [];
  let totalExpired = 0;

  // Process each company
  for (const company of companies) {
    try {
      const expiredCount = await cleanupCompanyMessages(
        company.id,
        currentConfig.timeoutMinutes,
        currentConfig.batchSize,
      );
      results.push({
        companyId: company.id,
        expiredCount,
      });
      totalExpired += expiredCount;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      results.push({
        companyId: company.id,
        expiredCount: 0,
        error: errorMessage,
      });
      console.error(
        `[MessageCleanup] Failed to cleanup company ${company.id}:`,
        error,
      );
    }
  }

  return {
    totalProcessed: companies.length,
    totalExpired,
    companies: results,
    durationMs: Date.now() - startTime,
    skipped: false,
  };
}

/**
 * Clean up stale pending messages for a specific company
 * Updates messages that have been pending for longer than the timeout
 * and broadcasts WebSocket notifications for affected messages
 */
export async function cleanupCompanyMessages(
  companyId: string,
  timeoutMinutes: number,
  batchSize: number,
): Promise<number> {
  const timeoutThreshold = new Date(
    Date.now() - timeoutMinutes * 60 * 1000,
  ).toISOString();

  // Check if tenant schema exists
  const schemaExists = await tenantSchemaExists(companyId);
  if (!schemaExists) {
    console.warn(
      `[MessageCleanup] Tenant schema does not exist for company ${companyId}`,
    );
    return 0;
  }

  const tenantDb = getTenantConnection(companyId);

  // First, fetch the messages that will be expired (for WebSocket notifications)
  // We need to get these before the update so we can include their details in the notification
  const messagesToExpire = await tenantDb
    .selectFrom("messages")
    .select(["id", "contact_id", "message_id", "status"])
    .where("status", "=", "pending")
    .where("from_me", "=", true)
    .where("timestamp", "<", new Date(timeoutThreshold))
    .where("metadata", "is", null) // Only update messages without existing metadata
    .limit(batchSize)
    .execute();

  if (messagesToExpire.length === 0) {
    return 0;
  }

  // Extract message IDs for the update query
  const messageIds = messagesToExpire.map((m) => m.id);

  // Update stale pending messages to failed status
  // Only target messages sent by the user (from_me = true)
  // that have been pending for longer than the timeout
  const result = await tenantDb
    .updateTable("messages")
    .set({
      status: "failed",
      metadata: sql<Record<string, unknown>>`jsonb_build_object(
        'error', 'delivery_timeout',
        'error_message', ${sql.lit(`Message delivery timed out after ${timeoutMinutes} minutes`)},
        'failed_at', now()
      )`,
    })
    .where("id", "in", messageIds)
    .execute();

  const expiredCount = Number(result.numUpdatedRows);

  if (expiredCount > 0) {
    console.log(
      `[MessageCleanup] Expired ${expiredCount} pending messages for company ${companyId}`,
    );

    // Broadcast WebSocket notifications for each expired message
    // Group by contact_id to minimize broadcasts
    const messagesByContact = new Map<string, typeof messagesToExpire>();
    for (const message of messagesToExpire) {
      const contactId = message.contact_id;
      if (!messagesByContact.has(contactId)) {
        messagesByContact.set(contactId, []);
      }
      messagesByContact.get(contactId)?.push(message);
    }

    // Send notification per contact (conversation)
    for (const [contactId, messages] of messagesByContact) {
      broadcastToCompany(companyId, {
        type: "message:status",
        payload: {
          messageIds: messages.map((m) => m.message_id || m.id),
          status: "failed",
          error: "delivery_timeout",
          errorMessage: `Message delivery timed out after ${timeoutMinutes} minutes`,
          conversationId: contactId,
        },
        timestamp: new Date().toISOString(),
      });
      console.log(
        `[MessageCleanup] Broadcast timeout notification for ${messages.length} message(s) in conversation ${contactId}`,
      );
    }
  }

  return expiredCount;
}

/**
 * Get all active companies
 * Returns companies with status = 'active' that have members
 */
async function getActiveCompanies(): Array<{ id: string }> {
  const result = await db
    .selectFrom("companies")
    .select(["id"])
    .where("status", "=", "active")
    .execute();

  return result.map((c: { id: string }) => ({ id: c.id }));
}

/**
 * Get message cleanup statistics for a company
 * Returns counts of messages by status
 */
export async function getCleanupStats(companyId: string): Promise<{
  pendingCount: number;
  failedCount: number;
  timeoutFailedCount: number;
}> {
  // Check if tenant schema exists
  const schemaExists = await tenantSchemaExists(companyId);
  if (!schemaExists) {
    return {
      pendingCount: 0,
      failedCount: 0,
      timeoutFailedCount: 0,
    };
  }

  const tenantDb = getTenantConnection(companyId);

  // Get counts in parallel
  const [pendingResult, failedResult, timeoutFailedResult] = await Promise.all([
    tenantDb
      .selectFrom("messages")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("status", "=", "pending")
      .where("from_me", "=", true)
      .executeTakeFirst(),
    tenantDb
      .selectFrom("messages")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("status", "=", "failed")
      .where("from_me", "=", true)
      .executeTakeFirst(),
    tenantDb
      .selectFrom("messages")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("status", "=", "failed")
      .where("from_me", "=", true)
      .where("metadata", "is not", null)
      .where(sql`metadata->>'error' = ${sql.lit("delivery_timeout")}`)
      .executeTakeFirst(),
  ]);

  return {
    pendingCount: Number(pendingResult?.count ?? 0),
    failedCount: Number(failedResult?.count ?? 0),
    timeoutFailedCount: Number(timeoutFailedResult?.count ?? 0),
  };
}

/**
 * Manually trigger cleanup for a specific company
 * Useful for testing or admin operations
 */
export async function triggerCleanupForCompany(
  companyId: string,
  timeoutMinutes?: number,
): Promise<number> {
  const timeout = timeoutMinutes ?? currentConfig.timeoutMinutes;
  return await cleanupCompanyMessages(
    companyId,
    timeout,
    currentConfig.batchSize,
  );
}

/**
 * Get detailed status of the cleanup service
 */
export async function getDetailedCleanupStatus(): Promise<{
  status: "running" | "stopped" | "disabled";
  config: MessageCleanupConfig;
  stats: {
    totalActiveCompanies: number;
    totalPendingMessages: number;
    totalFailedMessages: number;
    totalTimeoutFailedMessages: number;
  };
}> {
  const stats = {
    totalActiveCompanies: 0,
    totalPendingMessages: 0,
    totalFailedMessages: 0,
    totalTimeoutFailedMessages: 0,
  };

  // Get all active companies
  const companies = await getActiveCompanies();
  stats.totalActiveCompanies = companies.length;

  // Aggregate stats from all companies
  for (const company of companies) {
    const companyStats = await getCleanupStats(company.id);
    stats.totalPendingMessages += companyStats.pendingCount;
    stats.totalFailedMessages += companyStats.failedCount;
    stats.totalTimeoutFailedMessages += companyStats.timeoutFailedCount;
  }

  return {
    status: getMessageCleanupStatus(),
    config: getMessageCleanupConfig(),
    stats,
  };
}
