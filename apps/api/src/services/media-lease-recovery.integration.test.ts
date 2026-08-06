import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { MEDIA_DOWNLOAD_LEASE_MS } from "../config/media.config.js";
import type { DownloadResponseEvent } from "../lib/nats/index.js";
import { handleDownloadResponseEvent } from "./handlers/status-handlers.js";
import { releaseStrandedMediaDownloads } from "./message-cleanup.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Fixture {
  companyId: string;
  connectionId: string;
  contactId: string;
}

async function withTenant(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const connectionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();

  try {
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Media lease test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550003333",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: "15551234444@s.whatsapp.net",
        phone_number: "15551234444",
      })
      .execute();
    await run({ companyId, connectionId, contactId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
  }
}

async function insertMedia(
  fixture: Fixture,
  overrides: {
    status: string | null;
    claimedAt: Date | null;
    directPath?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await getTenantConnection(fixture.companyId)
    .insertInto("messages")
    .values({
      id,
      whatsapp_connection_id: fixture.connectionId,
      contact_id: fixture.contactId,
      message_id: `wa-${id}`,
      from_me: false,
      message_type: "image",
      media_direct_path:
        overrides.directPath === undefined ? "/v/t62.x" : overrides.directPath,
      media_download_status: overrides.status as never,
      media_downloaded_at: overrides.claimedAt,
      timestamp: new Date(),
    })
    .execute();
  return id;
}

async function statusOf(fixture: Fixture, id: string): Promise<string | null> {
  const row = await getTenantConnection(fixture.companyId)
    .selectFrom("messages")
    .select("media_download_status")
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.media_download_status ?? null;
}

const now = new Date("2026-08-06T12:00:00.000Z");
const expired = new Date(now.getTime() - MEDIA_DOWNLOAD_LEASE_MS - 60_000);
const fresh = new Date(now.getTime() - 30_000);

/**
 * A media download claim that the worker never answers leaves the row at
 * "downloading". The request path can reclaim an expired lease, but only if
 * somebody asks again - so without a sweep the client shows a permanent
 * "downloading" state with no way to retry.
 */
describe("stranded media download recovery", () => {
  integrationTest("returns an expired claim to pending", async () => {
    await withTenant(async (fixture) => {
      const id = await insertMedia(fixture, {
        status: "downloading",
        claimedAt: expired,
      });

      const released = await releaseStrandedMediaDownloads(
        fixture.companyId,
        MEDIA_DOWNLOAD_LEASE_MS,
        now,
      );

      expect(released).toBe(1);
      // "pending" is what makes the UI offer the retry that re-claims it.
      expect(await statusOf(fixture, id)).toBe("pending");
    });
  });

  integrationTest("leaves a live claim alone", async () => {
    await withTenant(async (fixture) => {
      const id = await insertMedia(fixture, {
        status: "downloading",
        claimedAt: fresh,
      });

      expect(
        await releaseStrandedMediaDownloads(
          fixture.companyId,
          MEDIA_DOWNLOAD_LEASE_MS,
          now,
        ),
      ).toBe(0);
      expect(await statusOf(fixture, id)).toBe("downloading");
    });
  });

  integrationTest(
    "releases a pre-lease claim that carries no timestamp",
    async () => {
      // Rows stranded before the lease existed have a NULL claim stamp.
      await withTenant(async (fixture) => {
        const id = await insertMedia(fixture, {
          status: "downloading",
          claimedAt: null,
        });

        expect(
          await releaseStrandedMediaDownloads(
            fixture.companyId,
            MEDIA_DOWNLOAD_LEASE_MS,
            now,
          ),
        ).toBe(1);
        expect(await statusOf(fixture, id)).toBe("pending");
      });
    },
  );

  integrationTest("never disturbs a completed or failed download", async () => {
    await withTenant(async (fixture) => {
      const completed = await insertMedia(fixture, {
        status: "completed",
        claimedAt: expired,
      });
      const failed = await insertMedia(fixture, {
        status: "failed",
        claimedAt: expired,
      });

      expect(
        await releaseStrandedMediaDownloads(
          fixture.companyId,
          MEDIA_DOWNLOAD_LEASE_MS,
          now,
        ),
      ).toBe(0);
      expect(await statusOf(fixture, completed)).toBe("completed");
      expect(await statusOf(fixture, failed)).toBe("failed");
    });
  });

  integrationTest(
    "skips a row with no media reference, which could not be retried anyway",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertMedia(fixture, {
          status: "downloading",
          claimedAt: expired,
          directPath: null,
        });

        expect(
          await releaseStrandedMediaDownloads(
            fixture.companyId,
            MEDIA_DOWNLOAD_LEASE_MS,
            now,
          ),
        ).toBe(0);
        expect(await statusOf(fixture, id)).toBe("downloading");
      });
    },
  );

  integrationTest("is idempotent and preserves media references", async () => {
    await withTenant(async (fixture) => {
      const id = await insertMedia(fixture, {
        status: "downloading",
        claimedAt: expired,
      });

      await releaseStrandedMediaDownloads(
        fixture.companyId,
        MEDIA_DOWNLOAD_LEASE_MS,
        now,
      );
      // A second sweep finds nothing left to do.
      expect(
        await releaseStrandedMediaDownloads(
          fixture.companyId,
          MEDIA_DOWNLOAD_LEASE_MS,
          now,
        ),
      ).toBe(0);

      // The retry needs these columns; the sweep must not clear them.
      const row = await getTenantConnection(fixture.companyId)
        .selectFrom("messages")
        .select(["media_direct_path", "media_download_status"])
        .where("id", "=", id)
        .executeTakeFirst();
      expect(row?.media_direct_path).toBe("/v/t62.x");
      expect(row?.media_download_status).toBe("pending");
    });
  });
});

/**
 * The sweep takes a companyId and resolves the tenant schema from it. These
 * prove it only ever touches that tenant's rows.
 */
describe("stranded media recovery is tenant-scoped", () => {
  integrationTest(
    "sweeping one workspace leaves another workspace's claims alone",
    async () => {
      await withTenant(async (tenantA) => {
        await withTenant(async (tenantB) => {
          const strandedA = await insertMedia(tenantA, {
            status: "downloading",
            claimedAt: expired,
          });
          const strandedB = await insertMedia(tenantB, {
            status: "downloading",
            claimedAt: expired,
          });

          const released = await releaseStrandedMediaDownloads(
            tenantA.companyId,
            MEDIA_DOWNLOAD_LEASE_MS,
            now,
          );

          expect(released).toBe(1);
          expect(await statusOf(tenantA, strandedA)).toBe("pending");
          // B is equally stranded and equally expired - and untouched.
          expect(await statusOf(tenantB, strandedB)).toBe("downloading");
        });
      });
    },
  );

  integrationTest(
    "a company with no tenant schema reports zero instead of erroring",
    async () => {
      // Provisioning can fail after the company row is written, and the sweep
      // runs for every ACTIVE company on every cycle - so without this guard a
      // half-provisioned workspace raises "relation does not exist" forever.
      // `cleanupCompanyMessages` already guards the same way.
      expect(
        await releaseStrandedMediaDownloads(
          crypto.randomUUID(),
          MEDIA_DOWNLOAD_LEASE_MS,
          now,
        ),
      ).toBe(0);
    },
  );

  integrationTest(
    "a workspace with nothing stranded reports zero and changes nothing",
    async () => {
      await withTenant(async (fixture) => {
        const completed = await insertMedia(fixture, {
          status: "completed",
          claimedAt: expired,
        });

        expect(
          await releaseStrandedMediaDownloads(
            fixture.companyId,
            MEDIA_DOWNLOAD_LEASE_MS,
            now,
          ),
        ).toBe(0);
        expect(await statusOf(fixture, completed)).toBe("completed");
      });
    },
  );
});

async function mediaUrlOf(
  fixture: Fixture,
  id: string,
): Promise<string | null> {
  const row = await getTenantConnection(fixture.companyId)
    .selectFrom("messages")
    .select("media_url")
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.media_url ?? null;
}

function downloadResponse(
  fixture: Fixture,
  messageId: string,
  mediaUrl: string,
): DownloadResponseEvent {
  return {
    contractVersion: 1,
    type: "download_response" as const,
    companyId: fixture.companyId,
    connectionId: fixture.connectionId,
    sessionId: fixture.connectionId,
    timestamp: new Date().toISOString(),
    payload: { messageId, success: true, mediaUrl, mediaSize: 1234 },
  };
}

/**
 * A claim whose lease expires while the worker is still running can be
 * re-claimed, so the same message can produce two download commands and
 * eventually two responses. The second must not overwrite the first.
 */
describe("download response is first-writer-wins", () => {
  integrationTest(
    "a late second response does not overwrite the stored media",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertMedia(fixture, {
          status: "downloading",
          claimedAt: expired,
        });

        await handleDownloadResponseEvent(
          downloadResponse(fixture, id, "s3://whatsapp-media/first.jpg"),
        );
        expect(await mediaUrlOf(fixture, id)).toBe(
          "s3://whatsapp-media/first.jpg",
        );

        // The duplicate worker finishes later with its own upload.
        await handleDownloadResponseEvent(
          downloadResponse(fixture, id, "s3://whatsapp-media/second.jpg"),
        );

        expect(await mediaUrlOf(fixture, id)).toBe(
          "s3://whatsapp-media/first.jpg",
        );
        expect(await statusOf(fixture, id)).toBe("completed");
      });
    },
  );

  integrationTest(
    "concurrent responses settle on exactly one of them",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertMedia(fixture, {
          status: "downloading",
          claimedAt: expired,
        });

        // Both in flight at once - the compare-and-set is what decides.
        await Promise.all([
          handleDownloadResponseEvent(
            downloadResponse(fixture, id, "s3://whatsapp-media/a.jpg"),
          ),
          handleDownloadResponseEvent(
            downloadResponse(fixture, id, "s3://whatsapp-media/b.jpg"),
          ),
        ]);

        const stored = await mediaUrlOf(fixture, id);
        expect(stored).not.toBeNull();
        expect([
          "s3://whatsapp-media/a.jpg",
          "s3://whatsapp-media/b.jpg",
        ]).toContain(stored as string);
        expect(await statusOf(fixture, id)).toBe("completed");
      });
    },
  );

  integrationTest(
    "a retry after a failed download still completes",
    async () => {
      // The guard must not block the legitimate case: a failed row is not
      // "already settled" and a later success has to apply.
      await withTenant(async (fixture) => {
        const id = await insertMedia(fixture, {
          status: "failed",
          claimedAt: expired,
        });

        await handleDownloadResponseEvent(
          downloadResponse(fixture, id, "s3://whatsapp-media/retry.jpg"),
        );

        expect(await mediaUrlOf(fixture, id)).toBe(
          "s3://whatsapp-media/retry.jpg",
        );
        expect(await statusOf(fixture, id)).toBe("completed");
      });
    },
  );
});

/**
 * The sweep runs once per cleanup interval per tenant against the largest
 * table in the schema. Without a covering index it plans as a sequential scan,
 * so a periodic maintenance task would scale its cost with total message
 * volume - see migration 064.
 */
describe("the stranded-media sweep is index-backed", () => {
  integrationTest("a new tenant has the claim index", async () => {
    await withTenant(async (fixture) => {
      const schemaName = getSchemaName(fixture.companyId);
      const indexes = await sql<{ indexname: string; indexdef: string }>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = ${schemaName} AND tablename = 'messages'
      `.execute(db);

      const claimIndex = indexes.rows.find(
        (row) => row.indexname === `${schemaName}_msg_dl_claim_idx`,
      );
      expect(claimIndex).toBeDefined();
      expect(claimIndex?.indexdef).toContain("media_downloaded_at");
      expect(claimIndex?.indexdef).toContain("'downloading'");
      expect(claimIndex?.indexname.length).toBeLessThanOrEqual(63);
    });
  });

  integrationTest(
    "the planner chooses that index for the sweep predicate",
    async () => {
      await withTenant(async (fixture) => {
        const schemaName = getSchemaName(fixture.companyId);
        // Inside a transaction on purpose: `SET LOCAL` is a no-op outside one
        // (PostgreSQL only warns), and on a pool the EXPLAIN could otherwise
        // land on a different connection entirely. Disabling seq scans makes
        // the assertion "this index is USABLE for the sweep predicate" rather
        // than "the planner happened to prefer it on an empty table".
        const text = await db.transaction().execute(async (trx) => {
          await sql`SET LOCAL enable_seqscan = off`.execute(trx);
          const plan = await sql<{ "QUERY PLAN": string }>`
            EXPLAIN (COSTS OFF)
            SELECT id FROM ${sql.raw(`"${schemaName}"."messages"`)}
            WHERE media_download_status = 'downloading'
              AND (media_downloaded_at IS NULL OR media_downloaded_at <= now())
              AND media_direct_path IS NOT NULL
          `.execute(trx);
          return plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        });

        expect(text).toContain("_msg_dl_claim_idx");
      });
    },
  );
});
