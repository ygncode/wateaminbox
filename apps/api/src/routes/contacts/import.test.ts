import { describe, expect, test } from "bun:test";
import { app } from "../../app.js";

describe("GET /api/contacts/import/template", () => {
  // The CSV template lives behind the workspace auth middleware. The frontend
  // must fetch it with a bearer token; making the route public would be the
  // wrong fix for an unauthenticated download.
  test("rejects requests without an Authorization header", async () => {
    const response = await app.request("/api/contacts/import/template");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      message: "Missing or invalid Authorization header",
    });
  });

  test("rejects a malformed Authorization header", async () => {
    const response = await app.request("/api/contacts/import/template", {
      headers: { Authorization: "NotBearer token" },
    });

    expect(response.status).toBe(401);
  });
});
