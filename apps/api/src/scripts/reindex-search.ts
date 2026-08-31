/**
 * Search reindex / repair CLI.
 *
 * The Meilisearch reindex is otherwise only reachable through
 * `POST /api/search/reindex`, which needs an admin bearer token. That leaves no
 * operator path when search data has to be inspected or repaired on a server,
 * so this script exposes the same work as a command.
 *
 * Usage in production (the image ships only `dist`, so run the bundle):
 *
 *   docker exec wateaminbox-production-api-1 \
 *     bun run apps/api/dist/scripts/reindex-search.js verify --all
 *
 * Usage in development:
 *
 *   bun src/scripts/reindex-search.ts verify --all
 *   bun src/scripts/reindex-search.ts repair-timestamps --company <uuid>
 *   bun src/scripts/reindex-search.ts rebuild --company <uuid>
 *
 * The script is a second bundler entrypoint in this package's build script; if
 * that entry is dropped, the command disappears from the image.
 *
 * Commands:
 *   verify             Report document counts and timestamp units. Read-only.
 *   repair-timestamps  Rewrite millisecond timestamps to seconds via partial
 *                      update. Touches only the timestamp field.
 *   rebuild            Re-derive every document from Postgres. Equivalent to
 *                      the HTTP endpoint.
 *
 * Flags:
 *   --company <uuid>   Target one workspace.
 *   --all              Target every active workspace.
 *   --dry-run          Report what would change without writing.
 */

import { db } from "@wateaminbox/database";
import { getContactDisplayName } from "@wateaminbox/shared";
import { createLogger, formatError } from "../lib/logger.js";
import * as meilisearchService from "../services/meilisearch.service.js";
import {
  getTenantConnection,
  tenantSchemaExists,
} from "../services/tenant.service.js";

const logger = createLogger("ReindexSearch");

/**
 * Timestamps are stored as Unix SECONDS. Anything past this bound is a
 * millisecond value written by an older indexer: seconds only reach 1e11 in
 * the year 5138, while current millisecond values are already ~1.7e12.
 */
const MILLISECOND_THRESHOLD = 1e11;

const DOCUMENT_PAGE_SIZE = 1000;

type Command = "verify" | "repair-timestamps" | "rebuild";

interface Options {
  command: Command;
  companyIds: string[];
  all: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const [command, ...rest] = argv;

  if (
    command !== "verify" &&
    command !== "repair-timestamps" &&
    command !== "rebuild"
  ) {
    throw new Error(
      `Unknown command ${command ?? "(none)"}. Expected verify, repair-timestamps, or rebuild.`,
    );
  }

  const companyIds: string[] = [];
  let all = false;
  let dryRun = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--company") {
      const value = rest[++i];
      if (!value) throw new Error("--company requires a workspace id");
      companyIds.push(value);
    } else {
      throw new Error(`Unknown flag ${arg}`);
    }
  }

  if (!all && companyIds.length === 0) {
    throw new Error("Pass --company <uuid> or --all");
  }

  return { command, companyIds, all, dryRun };
}

async function resolveCompanyIds(options: Options): Promise<string[]> {
  if (!options.all) return options.companyIds;

  const rows = await db
    .selectFrom("companies")
    .select(["id"])
    .where("status", "=", "active")
    .execute();

  return rows.map((row) => row.id);
}

/**
 * Page through an index reading only the fields needed to judge timestamp
 * units, so a large workspace never has to be held in memory as full documents.
 */
async function readTimestamps(
  companyId: string,
): Promise<Array<{ id: string; timestamp: unknown }>> {
  const index = await meilisearchService.getMessagesIndex(companyId);
  const docs: Array<{ id: string; timestamp: unknown }> = [];

  let offset = 0;
  while (true) {
    const page = await index.getDocuments<{ id: string; timestamp: unknown }>({
      limit: DOCUMENT_PAGE_SIZE,
      offset,
      fields: ["id", "timestamp"],
    });

    if (page.results.length === 0) break;
    docs.push(...page.results);
    offset += page.results.length;
    if (offset >= page.total) break;
  }

  return docs;
}

interface UnitReport {
  total: number;
  milliseconds: number;
  seconds: number;
  nonNumeric: number;
  oldest: string | null;
  newest: string | null;
}

function reportUnits(docs: Array<{ timestamp: unknown }>): UnitReport {
  let milliseconds = 0;
  let seconds = 0;
  let nonNumeric = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const doc of docs) {
    const value = doc.timestamp;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      nonNumeric++;
      continue;
    }

    if (value > MILLISECOND_THRESHOLD) milliseconds++;
    else seconds++;

    // Compare in seconds so a mixed-unit index still reports a sane range.
    const asSeconds =
      value > MILLISECOND_THRESHOLD ? Math.floor(value / 1000) : value;
    if (asSeconds < min) min = asSeconds;
    if (asSeconds > max) max = asSeconds;
  }

  return {
    total: docs.length,
    milliseconds,
    seconds,
    nonNumeric,
    oldest: Number.isFinite(min) ? new Date(min * 1000).toISOString() : null,
    newest: Number.isFinite(max) ? new Date(max * 1000).toISOString() : null,
  };
}

async function verify(companyId: string): Promise<UnitReport> {
  const report = reportUnits(await readTimestamps(companyId));
  logger.info({ companyId, ...report }, "Index timestamp report");
  return report;
}

async function repairTimestamps(
  companyId: string,
  dryRun: boolean,
): Promise<number> {
  const docs = await readTimestamps(companyId);
  const patches = docs
    .filter(
      (doc): doc is { id: string; timestamp: number } =>
        typeof doc.timestamp === "number" &&
        doc.timestamp > MILLISECOND_THRESHOLD,
    )
    .map((doc) => ({
      id: doc.id,
      timestamp: Math.floor(doc.timestamp / 1000),
    }));

  if (patches.length === 0) {
    logger.info({ companyId }, "No millisecond timestamps found");
    return 0;
  }

  if (dryRun) {
    logger.info(
      { companyId, wouldPatch: patches.length },
      "Dry run, nothing written",
    );
    return patches.length;
  }

  // updateDocuments is a partial update: only `timestamp` is rewritten, so
  // message content and contact naming stay exactly as indexed.
  const index = await meilisearchService.getMessagesIndex(companyId);
  const tasks = meilisearchService.getMeilisearchClient().tasks;
  for (let i = 0; i < patches.length; i += DOCUMENT_PAGE_SIZE) {
    const chunk = patches.slice(i, i + DOCUMENT_PAGE_SIZE);
    const enqueued = await index.updateDocuments(chunk);
    // Wait per chunk so a failed batch surfaces here instead of leaving the
    // index half-repaired with a success exit code.
    const task = await tasks.waitForTask(enqueued.taskUid);
    if (task.status !== "succeeded") {
      throw new Error(
        `Meilisearch task ${enqueued.taskUid} ${task.status}: ${task.error?.message ?? "unknown error"}`,
      );
    }
  }

  logger.info(
    { companyId, patched: patches.length },
    "Repaired millisecond timestamps",
  );
  return patches.length;
}

async function rebuild(companyId: string, dryRun: boolean): Promise<number> {
  const tenantDb = getTenantConnection(companyId);

  const messages = await tenantDb
    .selectFrom("messages")
    .innerJoin("contacts", "contacts.id", "messages.contact_id")
    .select([
      "messages.id",
      "messages.contact_id",
      "contacts.custom_name",
      "contacts.push_name",
      "contacts.username",
      "contacts.phone_number",
      "contacts.jid",
      "contacts.is_group",
      "messages.message_id",
      "messages.content",
      "messages.message_type",
      "messages.timestamp",
      "messages.from_me",
    ])
    .execute();

  const documents: meilisearchService.MessageDocument[] = messages
    .filter((m) => m.contact_id !== null)
    .map((m) => ({
      id: m.id,
      companyId,
      contactId: m.contact_id as string,
      contactName: getContactDisplayName(
        {
          jid: m.jid,
          custom_name: m.custom_name,
          push_name: m.push_name,
          username: m.username,
          phone_number: m.phone_number,
        },
        "Unknown",
      ),
      contactJid: m.jid,
      isGroup: m.is_group,
      messageId: m.message_id,
      content: m.content,
      messageType: m.message_type,
      // Unix SECONDS - must match message-handlers.ts and routes/search.ts.
      timestamp: Math.floor(new Date(m.timestamp).getTime() / 1000),
      fromMe: m.from_me,
    }));

  if (dryRun) {
    logger.info(
      { companyId, wouldIndex: documents.length },
      "Dry run, nothing written",
    );
    return documents.length;
  }

  await meilisearchService.indexMessages(companyId, documents);
  logger.info(
    { companyId, indexed: documents.length },
    "Rebuilt message index",
  );
  return documents.length;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!(await meilisearchService.isMeilisearchAvailable())) {
    throw new Error("Meilisearch is not reachable");
  }

  const companyIds = await resolveCompanyIds(options);
  if (companyIds.length === 0) {
    logger.warn("No workspaces matched");
    return;
  }

  let failed = 0;

  for (const companyId of companyIds) {
    // --all reads from the companies table, which can name a workspace whose
    // tenant schema was never provisioned.
    if (!(await tenantSchemaExists(companyId))) {
      logger.warn({ companyId }, "Skipping workspace with no tenant schema");
      continue;
    }

    try {
      if (options.command === "verify") {
        await verify(companyId);
      } else if (options.command === "repair-timestamps") {
        await repairTimestamps(companyId, options.dryRun);
      } else {
        await rebuild(companyId, options.dryRun);
      }
    } catch (error) {
      // Keep going so one bad workspace cannot strand the rest of an --all run.
      failed++;
      logger.error({ companyId, ...formatError(error) }, "Workspace failed");
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} of ${companyIds.length} workspaces failed`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(formatError(error), "Reindex failed");
    process.exit(1);
  });
