import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";
import { getBulkJobProgressMap } from "../services/bulk-job.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../services/tenant.service.js";
import { purgeArchivedConnection } from "../services/whatsapp/connection.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const PASSWORD = "Correct-Horse-123!";

async function loginHeaders(email: string, companyId: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

interface RouteJob {
  id: string;
  totalRecipients: number;
  progress: {
    total: number;
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    canceled: number;
    skipped: number;
  };
}

describe("GET /api/bulk-jobs and /api/bulk-jobs/:id", () => {
  integrationTest(
    "expose snapshot-consistent progress that never exceeds totalRecipients, before and after a connection purge",
    async () => {
      const companyId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const ownerEmail = `bulk-list-owner-${ownerId}@example.com`;
      let schemaCreated = false;

      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: ownerEmail,
            password_hash: await hashPassword(PASSWORD),
            email_verified_at: new Date(),
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Bulk list route test",
            schema_name: getSchemaName(companyId),
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
          .execute();
        await createTenantSchema(companyId);
        schemaCreated = true;
        const tenantDb = getTenantConnection(companyId);
        const at = new Date("2026-03-01T10:00:00Z");

        // An archived connection (purged) and a live connection (retained),
        // each owning a contact that one bulk job's leaves address, so the
        // job spans both connections and only the archived one is purged.
        const archivedConnectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: archivedConnectionId,
            name: "archived",
            jid: "list-archived@s.whatsapp.net",
            status: "disconnected",
            archived_at: new Date("2026-02-01T00:00:00Z"),
          })
          .execute();
        const archivedContactId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: archivedContactId,
            whatsapp_connection_id: archivedConnectionId,
            jid: "list-archived-direct@s.whatsapp.net",
            phone_number: "14150041",
            push_name: "archived",
          })
          .execute();
        const liveConnectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: liveConnectionId,
            name: "live",
            jid: "list-live@s.whatsapp.net",
            status: "connected",
            archived_at: null,
          })
          .execute();
        const liveContactId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: liveContactId,
            whatsapp_connection_id: liveConnectionId,
            jid: "list-live-direct@s.whatsapp.net",
            phone_number: "14150042",
            push_name: "live",
          })
          .execute();

        const purgedJobId = crypto.randomUUID();
        const liveJobId = crypto.randomUUID();
        for (const job of [
          {
            id: purgedJobId,
            name: "Purged route broadcast",
            total: 2,
            contactIds: [archivedContactId, archivedContactId],
          },
          {
            id: liveJobId,
            name: "Live route broadcast",
            total: 3,
            contactIds: [liveContactId, liveContactId, liveContactId],
          },
        ]) {
          await tenantDb
            .insertInto("bulk_jobs")
            .values({
              id: job.id,
              name: job.name,
              content: "hello",
              audience: { tagIds: [], contactIds: [] },
              audience_hash: "hash",
              scheduled_at: at,
              status: "running",
              total_recipients: job.total,
              created_by: ownerId,
            })
            .execute();
          await tenantDb
            .insertInto("scheduled_messages")
            .values(
              job.contactIds.map((contactId) => ({
                id: crypto.randomUUID(),
                contact_id: contactId,
                bulk_job_id: job.id,
                content: "broadcast",
                status: "sent" as const,
                scheduled_at: at,
                next_attempt_at: at,
                sent_at: at,
                created_by: ownerId,
              })),
            )
            .execute();
        }

        const headers = await loginHeaders(ownerEmail, companyId);

        // Pre-purge: GET /bulk-jobs/:id and GET /bulk-jobs return the live
        // leaf counts and never exceed totalRecipients.
        const detailBefore = await app.request(
          `/api/bulk-jobs/${purgedJobId}`,
          {
            headers,
          },
        );
        expect(detailBefore.status).toBe(200);
        const detailBodyBefore = (await detailBefore.json()) as {
          data: RouteJob;
        };
        expect(detailBodyBefore.data.totalRecipients).toBe(2);
        expect(detailBodyBefore.data.progress).toEqual({
          total: 2,
          pending: 0,
          processing: 0,
          sent: 2,
          failed: 0,
          canceled: 0,
          skipped: 0,
        });
        expect(detailBodyBefore.data.progress.total).toBeLessThanOrEqual(
          detailBodyBefore.data.totalRecipients,
        );

        const listBefore = await app.request("/api/bulk-jobs", { headers });
        expect(listBefore.status).toBe(200);
        const listBodyBefore = (await listBefore.json()) as {
          data: RouteJob[];
        };
        const purgedRowBefore = listBodyBefore.data.find(
          (row) => row.id === purgedJobId,
        );
        const liveRowBefore = listBodyBefore.data.find(
          (row) => row.id === liveJobId,
        );
        expect(purgedRowBefore?.progress).toEqual({
          total: 2,
          pending: 0,
          processing: 0,
          sent: 2,
          failed: 0,
          canceled: 0,
          skipped: 0,
        });
        expect(liveRowBefore?.progress).toEqual({
          total: 3,
          pending: 0,
          processing: 0,
          sent: 3,
          failed: 0,
          canceled: 0,
          skipped: 0,
        });
        for (const row of listBodyBefore.data) {
          expect(row.progress.total).toBeLessThanOrEqual(row.totalRecipients);
        }

        // Purge the archived connection; its two 'sent' leaves are retained in
        // bulk_jobs.purged_sent. The totals must stay honest through the map
        // variant that backs GET /bulk-jobs.
        const purgeResult = await purgeArchivedConnection(
          tenantDb,
          archivedConnectionId,
        );
        expect(purgeResult.affectedBulkJobIds).toEqual([purgedJobId]);

        const detailAfter = await app.request(`/api/bulk-jobs/${purgedJobId}`, {
          headers,
        });
        expect(detailAfter.status).toBe(200);
        const detailBodyAfter = (await detailAfter.json()) as {
          data: RouteJob;
        };
        // The purged job's leaves are gone; purged_sent keeps the totals at 2.
        expect(detailBodyAfter.data.progress).toEqual({
          total: 2,
          pending: 0,
          processing: 0,
          sent: 2,
          failed: 0,
          canceled: 0,
          skipped: 0,
        });
        expect(detailBodyAfter.data.progress.total).toBeLessThanOrEqual(
          detailBodyAfter.data.totalRecipients,
        );

        const listAfter = await app.request("/api/bulk-jobs", { headers });
        expect(listAfter.status).toBe(200);
        const listBodyAfter = (await listAfter.json()) as {
          data: RouteJob[];
        };
        const purgedRowAfter = listBodyAfter.data.find(
          (row) => row.id === purgedJobId,
        );
        const liveRowAfter = listBodyAfter.data.find(
          (row) => row.id === liveJobId,
        );
        expect(purgedRowAfter?.progress).toEqual({
          total: 2,
          pending: 0,
          processing: 0,
          sent: 2,
          failed: 0,
          canceled: 0,
          skipped: 0,
        });
        // The live job is untouched — purged counters never leak across jobs.
        expect(liveRowAfter?.progress).toEqual({
          total: 3,
          pending: 0,
          processing: 0,
          sent: 3,
          failed: 0,
          canceled: 0,
          skipped: 0,
        });
        for (const row of listBodyAfter.data) {
          expect(row.progress.total).toBeLessThanOrEqual(row.totalRecipients);
        }

        // Cross-check the route output against the service-level map for the
        // exact same job set, to pin the route as a thin pass-through.
        const serviceMap = await getBulkJobProgressMap(tenantDb, [
          purgedJobId,
          liveJobId,
        ]);
        expect(serviceMap.get(purgedJobId)).toEqual(purgedRowAfter?.progress);
        expect(serviceMap.get(liveJobId)).toEqual(liveRowAfter?.progress);
      } finally {
        await clearTenantConnection(companyId);
        if (schemaCreated) await dropTenantSchema(companyId);
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
    30_000,
  );
});
