/**
 * Document filename / MIME repair CLI.
 *
 * WhatsApp sends a document's original filename on the receive event, but until
 * the fix that accompanies this script the API dropped it. Those rows are
 * stored under a `<uuid>.bin` key with `application/octet-stream`, so the
 * browser saves them with no usable extension and Excel and Word refuse to open
 * them ("the file format or extension is not valid").
 *
 * The name itself is unrecoverable for those rows - nothing kept it. The *type*
 * is not: the stored bytes still carry their signature. This script reads a
 * small head and tail of each affected object, identifies the format, and
 * writes back `media_mime_type` plus a synthetic `metadata.fileName`
 * (`document-<date>.<ext>`). That is enough for the file to open in the
 * application it belongs to.
 *
 * Usage in production (the image ships only `dist`, so run the bundle):
 *
 *   docker exec wateaminbox-production-api-1 \
 *     bun run apps/api/dist/scripts/repair-document-names.js verify --all
 *
 * Usage in development:
 *
 *   bun src/scripts/repair-document-names.ts verify --all
 *   bun src/scripts/repair-document-names.ts repair --company <uuid> --dry-run
 *   bun src/scripts/repair-document-names.ts repair --company <uuid>
 *
 * The script is a bundler entrypoint in this package's build script; if that
 * entry is dropped, the command disappears from the image.
 *
 * Commands:
 *   verify   Report how many documents are unnamed and what they turn out to
 *            be. Read-only: it reads object bytes but writes nothing.
 *   repair   Write the recovered type and name. Only fills rows that have no
 *            name and no usable extension, so it is safe to re-run.
 *
 * Flags:
 *   --company <uuid>   Target one workspace.
 *   --all              Target every active workspace.
 *   --dry-run          Report what would change without writing.
 *   --limit <n>        Stop after n candidate messages per workspace.
 */

import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import { fileNameFromMediaKey } from "../lib/media-download-name.js";
import { sniffMediaType, type SniffedType } from "../lib/media-sniff.js";
import {
  getMediaObjectSize,
  readMediaRange,
  resolveMediaKeyForCompany,
} from "../lib/storage.js";
import {
  getTenantConnection,
  tenantSchemaExists,
} from "../services/tenant.service.js";

const logger = createLogger("RepairDocumentNames");

/** Enough for every signature this identifies, plus OLE directory sectors. */
const HEAD_BYTES = 8192;
/** ZIP central directory lives at the end; 64 KB covers ordinary archives. */
const TAIL_BYTES = 65536;

const PAGE_SIZE = 200;

type Command = "verify" | "repair";

interface Options {
  command: Command;
  companyIds: string[];
  all: boolean;
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Options {
  const [command, ...rest] = argv;

  if (command !== "verify" && command !== "repair") {
    throw new Error(
      `Unknown command ${command ?? "(none)"}. Expected verify or repair.`,
    );
  }

  const companyIds: string[] = [];
  let all = false;
  let dryRun = false;
  let limit: number | null = null;

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
    } else if (arg === "--limit") {
      const value = Number(rest[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      limit = value;
    } else {
      throw new Error(`Unknown flag ${arg}`);
    }
  }

  if (!all && companyIds.length === 0) {
    throw new Error("Pass --company <uuid> or --all");
  }

  return { command, companyIds, all, dryRun, limit };
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

interface Candidate {
  id: string;
  media_url: string;
  media_mime_type: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: Date;
}

/**
 * Documents that have no name to offer.
 *
 * A row is a candidate only when the stored metadata has no `fileName` AND the
 * storage key has none embedded either - the key-derived fallback already
 * covers the second case at read time, and rewriting those rows would replace a
 * real name with a synthetic one.
 */
async function findCandidates(
  companyId: string,
  limit: number | null,
): Promise<Candidate[]> {
  const tenantDb = getTenantConnection(companyId);
  const candidates: Candidate[] = [];
  let offset = 0;

  while (true) {
    const page = await tenantDb
      .selectFrom("messages")
      .select(["id", "media_url", "media_mime_type", "metadata", "timestamp"])
      .where("message_type", "=", "document")
      .where("media_url", "is not", null)
      .where((eb) =>
        eb.or([
          eb(sql<string | null>`metadata->>'fileName'`, "is", null),
          eb(sql<string | null>`metadata->>'fileName'`, "=", ""),
        ]),
      )
      .orderBy("timestamp", "desc")
      .limit(PAGE_SIZE)
      .offset(offset)
      .execute();

    if (page.length === 0) break;
    offset += page.length;

    for (const row of page) {
      if (!row.media_url) continue;
      if (fileNameFromMediaKey(row.media_url)) continue;
      candidates.push(row as Candidate);
      if (limit && candidates.length >= limit) return candidates;
    }

    if (page.length < PAGE_SIZE) break;
  }

  return candidates;
}

/** Read the object's head and, when it is large enough to have one, its tail. */
async function identify(
  candidate: Candidate,
  companyId: string,
): Promise<SniffedType | null> {
  const key = resolveMediaKeyForCompany(candidate.media_url, companyId);
  const size = await getMediaObjectSize(key);
  if (size === 0) return null;

  const head = await readMediaRange(key, 0, Math.min(HEAD_BYTES, size) - 1);
  // Skip the second request when the whole object already fits in the head.
  const tail =
    size > HEAD_BYTES
      ? await readMediaRange(key, Math.max(0, size - TAIL_BYTES), size - 1)
      : Buffer.alloc(0);

  return sniffMediaType(head, tail);
}

function repairedName(candidate: Candidate, type: SniffedType): string {
  const day = candidate.timestamp.toISOString().slice(0, 10);
  return `document-${day}.${type.extension}`;
}

async function processCompany(
  companyId: string,
  options: Options,
): Promise<void> {
  const candidates = await findCandidates(companyId, options.limit);
  if (candidates.length === 0) {
    logger.info({ companyId }, "No unnamed documents");
    return;
  }

  const byExtension = new Map<string, number>();
  let unidentified = 0;
  let repaired = 0;
  let failed = 0;

  for (const candidate of candidates) {
    let type: SniffedType | null = null;
    try {
      type = await identify(candidate, companyId);
    } catch (error) {
      // A missing or unreadable object is not a reason to abandon the rest.
      failed++;
      logger.warn(
        { companyId, messageId: candidate.id, ...formatError(error) },
        "Could not read media object",
      );
      continue;
    }

    if (!type) {
      unidentified++;
      continue;
    }
    byExtension.set(type.extension, (byExtension.get(type.extension) ?? 0) + 1);

    if (options.command === "verify" || options.dryRun) continue;

    const fileName = repairedName(candidate, type);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .updateTable("messages")
      .set({
        media_mime_type: type.mimeType,
        metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
          fileName,
        })}::jsonb`,
      })
      .where("id", "=", candidate.id)
      // Re-check under the write: a concurrent receive or an earlier run of
      // this script may have filled the name since the row was selected.
      .where((eb) =>
        eb.or([
          eb(sql<string | null>`metadata->>'fileName'`, "is", null),
          eb(sql<string | null>`metadata->>'fileName'`, "=", ""),
        ]),
      )
      .execute();
    repaired++;
  }

  logger.info(
    {
      companyId,
      candidates: candidates.length,
      identified: Object.fromEntries(byExtension),
      unidentified,
      unreadable: failed,
      repaired,
      dryRun: options.dryRun,
      command: options.command,
    },
    "Workspace processed",
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
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
      await processCompany(companyId, options);
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
    logger.error(formatError(error), "Document name repair failed");
    process.exit(1);
  });
