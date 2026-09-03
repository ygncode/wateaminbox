import { describe, expect, test } from "bun:test";
import { apiTokenIdParamSchema, createApiTokenSchema } from "./api-token.js";

describe("createApiTokenSchema", () => {
  test("trims names before enforcing the minimum length", () => {
    expect(
      createApiTokenSchema.safeParse({ name: "   ", scopes: ["read"] }).success,
    ).toBe(false);
    const parsed = createApiTokenSchema.parse({
      name: "  Claude  ",
      scopes: ["read"],
    });
    expect(parsed.name).toBe("Claude");
  });

  test("requires read scope and permits read plus write", () => {
    expect(
      createApiTokenSchema.safeParse({ name: "Agent", scopes: ["write"] })
        .success,
    ).toBe(false);
    expect(
      createApiTokenSchema.safeParse({ name: "Agent", scopes: ["read"] })
        .success,
    ).toBe(true);
    expect(
      createApiTokenSchema.safeParse({
        name: "Agent",
        scopes: ["read", "write"],
      }).success,
    ).toBe(true);
  });
});

describe("apiTokenIdParamSchema", () => {
  test("rejects malformed token ids before they reach PostgreSQL", () => {
    expect(apiTokenIdParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(
      apiTokenIdParamSchema.safeParse({
        id: "123e4567-e89b-42d3-a456-426614174000",
      }).success,
    ).toBe(true);
  });
});
