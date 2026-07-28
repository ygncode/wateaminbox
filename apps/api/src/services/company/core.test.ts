import { describe, expect, test } from "bun:test";
import { toCompanyResponse } from "./core.js";

describe("company response serialization", () => {
  test("returns public camelCase timestamps", async () => {
    const response = await toCompanyResponse({
      id: "workspace-1",
      name: "Northwind Support",
      description: "Customer care",
      logo_key: null,
      schema_name: "tenant_workspace_1",
      status: "active",
      created_at: new Date("2026-07-01T10:15:30.000Z"),
      updated_at: new Date("2026-07-02T11:20:40.000Z"),
    });

    expect(response).toEqual({
      id: "workspace-1",
      name: "Northwind Support",
      description: "Customer care",
      logoUrl: null,
      status: "active",
      createdAt: "2026-07-01T10:15:30.000Z",
      updatedAt: "2026-07-02T11:20:40.000Z",
    });
    expect("created_at" in response).toBe(false);
    expect("schema_name" in response).toBe(false);
  });
});
