import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import { createCompany } from "../../services/company/core.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function loginAndGetHeaders(
  email: string,
  password: string,
  companyId: string,
) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

describe("SLA policy route authorization", () => {
  integrationTest(
    "members can read the current policy but cannot create a new version; admins/owners can",
    async () => {
      const ownerId = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const ownerEmail = `owner-${ownerId}@example.com`;
      const memberEmail = `member-${memberId}@example.com`;
      const password = "Correct-Horse-123!";
      let companyId: string | undefined;

      try {
        await db
          .insertInto("users")
          .values([
            {
              id: ownerId,
              email: ownerEmail,
              password_hash: await hashPassword(password),
              email_verified_at: new Date(),
            },
            {
              id: memberId,
              email: memberEmail,
              password_hash: await hashPassword(password),
              email_verified_at: new Date(),
            },
          ])
          .execute();

        const company = await createCompany(
          { name: "SLA authz test" },
          ownerId,
        );
        companyId = company.id;
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: memberId, role: "member" })
          .execute();

        const ownerHeaders = await loginAndGetHeaders(
          ownerEmail,
          password,
          companyId,
        );
        const memberHeaders = await loginAndGetHeaders(
          memberEmail,
          password,
          companyId,
        );

        // A member can read the current policy (read-only summary is fine).
        const memberReadResponse = await app.request(
          `/api/companies/${companyId}/sla-policy`,
          {
            headers: memberHeaders,
          },
        );
        expect(memberReadResponse.status).toBe(200);

        const validPolicyBody = JSON.stringify({
          targetMinutes: 45,
          timezone: "Asia/Yangon",
          weeklySchedule: [
            { weekday: 0, open: false, intervals: [] },
            {
              weekday: 1,
              open: true,
              intervals: [{ start: "09:00", end: "17:00" }],
            },
            {
              weekday: 2,
              open: true,
              intervals: [{ start: "09:00", end: "17:00" }],
            },
            {
              weekday: 3,
              open: true,
              intervals: [{ start: "09:00", end: "17:00" }],
            },
            {
              weekday: 4,
              open: true,
              intervals: [{ start: "09:00", end: "17:00" }],
            },
            {
              weekday: 5,
              open: true,
              intervals: [{ start: "09:00", end: "17:00" }],
            },
            { weekday: 6, open: false, intervals: [] },
          ],
          exceptions: [],
        });

        // A member is forbidden from creating a new policy version.
        const memberWriteResponse = await app.request(
          `/api/companies/${companyId}/sla-policy`,
          { method: "POST", headers: memberHeaders, body: validPolicyBody },
        );
        expect(memberWriteResponse.status).toBe(403);

        // The owner can.
        const ownerWriteResponse = await app.request(
          `/api/companies/${companyId}/sla-policy`,
          { method: "POST", headers: ownerHeaders, body: validPolicyBody },
        );
        expect(ownerWriteResponse.status).toBe(200);
        const created = (await ownerWriteResponse.json()) as {
          data: { targetMinutes: number; timezone: string };
        };
        expect(created.data.targetMinutes).toBe(45);
        expect(created.data.timezone).toBe("Asia/Yangon");

        // The new version is now what both roles see as current.
        const memberReadAfter = await app.request(
          `/api/companies/${companyId}/sla-policy`,
          {
            headers: memberHeaders,
          },
        );
        const afterBody = (await memberReadAfter.json()) as {
          data: { targetMinutes: number };
        };
        expect(afterBody.data.targetMinutes).toBe(45);

        // History now has 2 entries and is readable by a member too.
        const historyResponse = await app.request(
          `/api/companies/${companyId}/sla-policy/history`,
          { headers: memberHeaders },
        );
        expect(historyResponse.status).toBe(200);
        const historyBody = (await historyResponse.json()) as {
          data: unknown[];
        };
        expect(historyBody.data).toHaveLength(2);
      } finally {
        if (companyId) {
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
        await db
          .deleteFrom("users")
          .where("id", "in", [ownerId, memberId])
          .execute();
      }
    },
  );

  integrationTest(
    "rejects an invalid policy (never-open schedule) with a validation error, not a 500",
    async () => {
      const ownerId = crypto.randomUUID();
      const ownerEmail = `owner-invalid-${ownerId}@example.com`;
      const password = "Correct-Horse-123!";
      let companyId: string | undefined;

      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: ownerEmail,
            password_hash: await hashPassword(password),
            email_verified_at: new Date(),
          })
          .execute();
        const company = await createCompany(
          { name: "SLA validation test" },
          ownerId,
        );
        companyId = company.id;

        const headers = await loginAndGetHeaders(
          ownerEmail,
          password,
          companyId,
        );

        const response = await app.request(
          `/api/companies/${companyId}/sla-policy`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              targetMinutes: 60,
              timezone: "UTC",
              weeklySchedule: Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                open: false,
                intervals: [],
              })),
              exceptions: [],
            }),
          },
        );

        expect(response.status).toBe(400);
      } finally {
        if (companyId) {
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );
});
