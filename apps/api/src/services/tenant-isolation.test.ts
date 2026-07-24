import { describe, expect, test } from "bun:test";
import { getSchemaName, getTenantConnection } from "./tenant.service.js";

describe("tenant schema isolation", () => {
  test("two companies compile every table reference into distinct schemas", () => {
    const companyA = "11111111-1111-4111-8111-111111111111";
    const companyB = "22222222-2222-4222-8222-222222222222";
    const queryA = getTenantConnection(companyA)
      .selectFrom("messages")
      .select("id")
      .compile().sql;
    const queryB = getTenantConnection(companyB)
      .selectFrom("messages")
      .select("id")
      .compile().sql;

    expect(getSchemaName(companyA)).not.toBe(getSchemaName(companyB));
    expect(queryA).toContain(`"${getSchemaName(companyA)}"."messages"`);
    expect(queryB).toContain(`"${getSchemaName(companyB)}"."messages"`);
    expect(queryA).not.toContain(getSchemaName(companyB));
    expect(queryB).not.toContain(getSchemaName(companyA));
  });
});
