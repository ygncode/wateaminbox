import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  getCleanupConfig,
  type MessageCleanupConfig,
} from "../config/cleanup.config.js";
import { MEDIA_DOWNLOAD_LEASE_MS } from "../config/media.config.js";
import { createLogger } from "../lib/logger.js";
import { broadcastToContactViewers } from "./message-broadcast.service.js";
import { getTenantConnection, tenantSchemaExists } from "./tenant.service.js";

const logger = createLogger("MessageCleanup");

// Re-export the type for consumers of this service
export type { MessageCleanupConfig };

// ============================================================================
// Service State
// ============================================================================

let cleanupTimerId: ReturnType<typeof setTimeout> | null = null;
let inFlightCycle: Promise<void> | null = null;
let isInitialized = false;
let lifecycleGeneration = 0;
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
  logger.info({ config: currentConfig }, "Configuration updated");
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
  cycleOverrides: Partial<CleanupCycleDeps> = {},
): Promise<void> {
  if (isInitialized) {
    logger.debug("Already initialized");
    return;
  }

  if (config) {
    currentConfig = { ...getCleanupConfig(), ...config };
  }

  if (!currentConfig.enabled) {
    logger.info("Disabled by configuration");
    return;
  }

  logger.info({ config: currentConfig }, "Initializing with config");
  isInitialized = true;
  const generation = ++lifecycleGeneration;

  const runAndLog = async (initial: boolean): Promise<void> => {
    try {
      const result = await runCleanupCycle(cycleOverrides);
      if (result.skipped) {
        logger.debug("Cleanup cycle skipped (no active companies)");
      } else {
        logger.info(
          {
            totalExpired: result.totalExpired,
            companyCount: result.companies.length,
            durationMs: result.durationMs,
          },
          initial ? "Initial cleanup complete" : "Cleanup cycle complete",
        );
      }
    } catch (error) {
      logger.error(
        { err: error },
        initial ? "Initial cleanup failed" : "Cleanup cycle failed",
      );
    }
  };

  const runTracked = async (initial: boolean): Promise<void> => {
    const cycle = runAndLog(initial);
    inFlightCycle = cycle;
    try {
      await cycle;
    } finally {
      if (inFlightCycle === cycle) inFlightCycle = null;
    }
  };

  const intervalMs = currentConfig.intervalMinutes * 60 * 1000;
  const scheduleNext = (): void => {
    if (!isInitialized || lifecycleGeneration !== generation) return;
    cleanupTimerId = setTimeout(async () => {
      cleanupTimerId = null;
      await runTracked(false);
      // Schedule from completion, not from start. A slow cycle can therefore
      // never overlap the next cycle in this replica.
      scheduleNext();
    }, intervalMs);
  };

  await runTracked(true);
  scheduleNext();

  logger.info(
    { intervalMinutes: currentConfig.intervalMinutes },
    "Initialized and running",
  );
}

/**
 * Shutdown the message cleanup service
 * Stops the periodic interval and cleans up resources
 */
export async function shutdownMessageCleanup(): Promise<void> {
  isInitialized = false;
  lifecycleGeneration++;
  if (cleanupTimerId) {
    clearTimeout(cleanupTimerId);
    cleanupTimerId = null;
  }
  // Do not report a stopped service while its previous timer callback can
  // still be mutating tenant rows or broadcasting events.
  await inFlightCycle;
  logger.info("Shutdown complete");
}

/**
 * Collaborators of a cleanup cycle.
 *
 * Injectable so the cycle's per-tenant error isolation can be tested without a
 * database - matching the seam other services already use (`dispatchCompany`'s
 * publisher, `getCommandOutboxBacklog`'s loader).
 */
export interface CleanupCycleDeps {
  listCompanies: () => Promise<Array<{ id: string }>>;
  cleanupMessages: (
    companyId: string,
    timeoutMinutes: number,
    batchSize: number,
  ) => Promise<number>;
  releaseMedia: (companyId: string) => Promise<number>;
}

/**
 * Production wiring. `runCleanupCycle` resolves overrides against this once,
 * and the loop below reads ONLY the resolved object - so adding a new
 * collaborator means adding it here and to `CleanupCycleDeps`, rather than
 * calling a module function directly and silently escaping the test seam.
 */
const defaultCleanupDeps: CleanupCycleDeps = {
  listCompanies: () => getActiveCompanies(),
  cleanupMessages: (companyId, timeoutMinutes, batchSize) =>
    cleanupCompanyMessages(companyId, timeoutMinutes, batchSize),
  releaseMedia: (companyId) => releaseStrandedMediaDownloads(companyId),
};

/**
 * Run a single cleanup cycle
 * Iterates through all active companies and expires stale pending messages
 */
export async function runCleanupCycle(
  overrides: Partial<CleanupCycleDeps> = {},
): Promise<CleanupCycleResult> {
  const { listCompanies, cleanupMessages, releaseMedia }: CleanupCycleDeps = {
    ...defaultCleanupDeps,
    ...overrides,
  };
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
  const companies = await listCompanies();

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
      const expiredCount = await cleanupMessages(
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
      logger.error(
        { err: error, companyId: company.id },
        "Failed to cleanup company",
      );
    }

    // Isolated from the message cleanup above, and from every other tenant.
    // The two are independent maintenance tasks that happen to share a cycle:
    // a media sweep failure must not discard an already-completed message
    // cleanup's result, and neither must stop the remaining tenants.
    try {
      await releaseMedia(company.id);
    } catch (error) {
      logger.error(
        { err: error, companyId: company.id },
        "Failed to release stranded media downloads",
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
 * Release media downloads whose claim lease expired.
 *
 * `POST /media/download/:id` claims a row by setting `media_download_status`
 * to "downloading" with `media_downloaded_at` as the claim stamp, and the
 * worker's response settles it. If that response never arrives - worker crash,
 * restart, dropped event - the row stays "downloading". The route can reclaim
 * an expired lease, but only if somebody asks again; until then the client
 * shows a permanent "downloading" state with no way out.
 *
 * Returning the row to "pending" is what makes it self-healing: `mediaPending`
 * goes true again, so the UI offers the retry that re-claims it. This never
 * touches a completed or failed download, and never deletes anything - the
 * media reference columns are untouched, so the retry has everything it needs.
 */
export async function releaseStrandedMediaDownloads(
  companyId: string,
  leaseMs: number = MEDIA_DOWNLOAD_LEASE_MS,
  now: Date = new Date(),
): Promise<number> {
  // Same guard `cleanupCompanyMessages` uses. An active company whose tenant
  // schema is missing (provisioning failed part-way) would otherwise raise
  // "relation does not exist" on every cleanup cycle, forever.
  if (!(await tenantSchemaExists(companyId))) {
    logger.warn({ companyId }, "Tenant schema does not exist for company");
    return 0;
  }

  const tenantDb = getTenantConnection(companyId);
  const cutoff = new Date(now.getTime() - leaseMs);

  const result = await tenantDb
    .updateTable("messages")
    .set({ media_download_status: "pending" })
    .where("media_download_status", "=", "downloading")
    .where((eb) =>
      eb.or([
        eb("media_downloaded_at", "is", null),
        eb("media_downloaded_at", "<=", cutoff),
      ]),
    )
    // Only rows that can actually be retried; without a direct path the
    // download route rejects the request anyway.
    .where("media_direct_path", "is not", null)
    .executeTakeFirst();

  const released = Number(result.numUpdatedRows ?? 0n);
  if (released > 0) {
    logger.info(
      { companyId, released, leaseMinutes: leaseMs / 60_000 },
      "Released stranded media download claims",
    );
  }
  return released;
}

/**
 * Clean up stale pending messages for a specific company
 * Updates messages that have been pending for longer than the timeout
 * and broadcasts realtime notifications for affected messages
 */
type CleanupBroadcaster = typeof broadcastToContactViewers;

export async function cleanupCompanyMessages(
  companyId: string,
  timeoutMinutes: number,
  batchSize: number,
  broadcast: CleanupBroadcaster = broadcastToContactViewers,
): Promise<number> {
  const timeoutThreshold = new Date(
    Date.now() - timeoutMinutes * 60 * 1000,
  ).toISOString();

  // Check if tenant schema exists
  const schemaExists = await tenantSchemaExists(companyId);
  if (!schemaExists) {
    logger.warn({ companyId }, "Tenant schema does not exist for company");
    return 0;
  }

  const tenantDb = getTenantConnection(companyId);

  const cutoff = new Date(timeoutThreshold);
  const errorMessage = `Message delivery timed out after ${timeoutMinutes} minutes`;

  // Select and transition inside one short transaction. Row locks plus
  // SKIP LOCKED give concurrent replicas disjoint, strictly bounded batches.
  // Repeating every eligibility predicate on UPDATE makes a newer receipt win
  // rather than allowing cleanup to overwrite it.
  const messagesToExpire = await tenantDb.transaction().execute(async (trx) => {
    const candidates = await trx
      .selectFrom("messages")
      .select("id")
      .where("status", "=", "pending")
      .where("from_me", "=", true)
      .where("timestamp", "<", cutoff)
      .where("metadata", "is", null)
      .orderBy("timestamp", "asc")
      .orderBy("id", "asc")
      .limit(batchSize)
      .forUpdate()
      .skipLocked()
      .execute();
    if (candidates.length === 0) return [];

    return trx
      .updateTable("messages")
      .set({
        status: "failed",
        metadata: sql<Record<string, unknown>>`jsonb_build_object(
          'error', 'delivery_timeout',
          'error_message', ${errorMessage}::text,
          'failed_at', now()
        )`,
      })
      .where(
        "id",
        "in",
        candidates.map((candidate) => candidate.id),
      )
      .where("status", "=", "pending")
      .where("from_me", "=", true)
      .where("timestamp", "<", cutoff)
      .where("metadata", "is", null)
      .returning(["id", "contact_id", "message_id", "status"])
      .execute();
  });

  const expiredCount = messagesToExpire.length;

  if (expiredCount > 0) {
    logger.info(
      { expiredCount, companyId },
      "Expired pending messages for company",
    );

    // Broadcast realtime notifications for each expired message
    // Group by contact_id to minimize broadcasts
    const messagesByContact = new Map<string, typeof messagesToExpire>();
    for (const message of messagesToExpire) {
      const contactId = message.contact_id ?? "unknown";
      if (!messagesByContact.has(contactId)) {
        messagesByContact.set(contactId, []);
      }
      messagesByContact.get(contactId)?.push(message);
    }

    // Send notification per contact (conversation)
    for (const [contactId, messages] of messagesByContact) {
      await broadcast(companyId, contactId, "message:status", {
        messageIds: messages.map((m) => m.message_id || m.id),
        status: "failed",
        error: "delivery_timeout",
        errorMessage: `Message delivery timed out after ${timeoutMinutes} minutes`,
        conversationId: contactId,
      });
      logger.debug(
        { messageCount: messages.length, contactId },
        "Broadcast timeout notification for messages in conversation",
      );
    }
  }

  return expiredCount;
}

/**
 * Get all active companies
 * Returns companies with status = 'active' that have members
 */
async function getActiveCompanies(): Promise<Array<{ id: string }>> {
  const result = await db
    .selectFrom("companies")
    .select(["id"])
    .where("status", "=", "active")
    .execute();

  return result.map((c) => ({ id: c.id }));
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
      .where(sql<boolean>`metadata->>'error' = 'delivery_timeout'`)
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
