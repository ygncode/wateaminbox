import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";
import {
  createBulkJob,
  resolveBulkAudience,
} from "../services/bulk-job.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../services/tenant.service.js";

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

describe("PATCH /api/bulk-jobs/:id/schedule", () => {
  integrationTest(
    "validates time, enforces both broadcast permissions, and audits a valid reschedule",
    async () => {
      const companyId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const ownerEmail = `bulk-owner-${ownerId}@example.com`;
      const memberEmail = `bulk-member-${memberId}@example.com`;
      let schemaCreated = false;

      try {
        await db
          .insertInto("users")
          .values([
            {
              id: ownerId,
              email: ownerEmail,
              password_hash: await hashPassword(PASSWORD),
              email_verified_at: new Date(),
            },
            {
              id: memberId,
              email: memberEmail,
              password_hash: await hashPassword(PASSWORD),
              email_verified_at: new Date(),
            },
          ])
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Broadcast reschedule route test",
            schema_name: getSchemaName(companyId),
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values([
            { company_id: companyId, user_id: ownerId, role: "owner" },
            {
              company_id: companyId,
              user_id: memberId,
              role: "member",
              permissions: {
                can_send_messages: true,
                can_send_bulk_messages: false,
              },
            },
          ])
          .execute();
        await createTenantSchema(companyId);
        schemaCreated = true;
        const tenantDb = getTenantConnection(companyId);
        const connection = await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            name: "Bulk route line",
            jid: "15550001111@s.whatsapp.net",
            status: "connected",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const contact = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connection.id,
            jid: "15550002222@s.whatsapp.net",
            phone_number: "+15550002222",
            push_name: "Route Recipient",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const audience = { tagIds: [], contactIds: [contact.id] };
        const resolved = await resolveBulkAudience(tenantDb, audience);
        const originalTime = new Date(Date.now() + 3_600_000);
        const { job } = await createBulkJob(tenantDb, {
          name: "Route reschedule",
          audience,
          content: "Hello",
          messageType: "text",
          mediaUrl: null,
          mediaMimeType: null,
          mediaFileName: null,
          scheduledAt: originalTime,
          audienceHash: resolved.audienceHash,
          idempotencyKey: crypto.randomUUID(),
          createdBy: ownerId,
        });
        const [ownerHeaders, memberHeaders] = await Promise.all([
          loginHeaders(ownerEmail, companyId),
          loginHeaders(memberEmail, companyId),
        ]);

        const pastResponse = await app.request(
          `/api/bulk-jobs/${job.id}/schedule`,
          {
            method: "PATCH",
            headers: ownerHeaders,
            body: JSON.stringify({
              scheduledAt: new Date(Date.now() - 60_000).toISOString(),
            }),
          },
        );
        expect(pastResponse.status).toBe(400);

        const unauthorizedResponse = await app.request(
          `/api/bulk-jobs/${job.id}/schedule`,
          {
            method: "PATCH",
            headers: memberHeaders,
            body: JSON.stringify({
              scheduledAt: new Date(Date.now() + 7_200_000).toISOString(),
            }),
          },
        );
        expect(unauthorizedResponse.status).toBe(403);

        await db
          .updateTable("company_members")
          .set({
            permissions: {
              can_send_messages: false,
              can_send_bulk_messages: true,
            },
          })
          .where("company_id", "=", companyId)
          .where("user_id", "=", memberId)
          .execute();
        const sendDeniedResponse = await app.request(
          `/api/bulk-jobs/${job.id}/schedule`,
          {
            method: "PATCH",
            headers: memberHeaders,
            body: JSON.stringify({
              scheduledAt: new Date(Date.now() + 7_200_000).toISOString(),
            }),
          },
        );
        expect(sendDeniedResponse.status).toBe(403);

        const nextTime = new Date(Date.now() + 10_800_000);
        const validResponse = await app.request(
          `/api/bulk-jobs/${job.id}/schedule`,
          {
            method: "PATCH",
            headers: ownerHeaders,
            body: JSON.stringify({ scheduledAt: nextTime.toISOString() }),
          },
        );
        expect(validResponse.status).toBe(200);
        const responseBody = (await validResponse.json()) as {
          data: { id: string; scheduledAt: string; status: string };
        };
        expect(responseBody.data.id).toBe(job.id);
        expect(responseBody.data.status).toBe("scheduled");
        expect(responseBody.data.scheduledAt).toBe(nextTime.toISOString());

        const audit = await tenantDb
          .selectFrom("audit_logs")
          .select(["user_id", "action", "details"])
          .where("entity_id", "=", job.id)
          .where("action", "=", "bulk_job.rescheduled")
          .executeTakeFirstOrThrow();
        expect(audit.user_id).toBe(ownerId);
        expect(audit.details).toMatchObject({
          previousScheduledAt: originalTime.toISOString(),
          scheduledAt: nextTime.toISOString(),
        });

        // A dispatcher claim that wins after the UI loaded becomes a stable
        // 409 rather than partially moving the remaining recipient rows.
        await tenantDb
          .updateTable("scheduled_messages")
          .set({ status: "processing" })
          .where("bulk_job_id", "=", job.id)
          .execute();
        const racedResponse = await app.request(
          `/api/bulk-jobs/${job.id}/schedule`,
          {
            method: "PATCH",
            headers: ownerHeaders,
            body: JSON.stringify({
              scheduledAt: new Date(Date.now() + 14_400_000).toISOString(),
            }),
          },
        );
        expect(racedResponse.status).toBe(409);
        const afterConflict = await tenantDb
          .selectFrom("bulk_jobs")
          .select("scheduled_at")
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(afterConflict.scheduled_at.getTime()).toBe(nextTime.getTime());
      } finally {
        await clearTenantConnection(companyId);
        if (schemaCreated) await dropTenantSchema(companyId);
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db
          .deleteFrom("users")
          .where("id", "in", [ownerId, memberId])
          .execute();
      }
    },
    30_000,
  );
});
