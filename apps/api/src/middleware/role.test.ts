import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireAdmin, requireOwner } from "./role.js";

function appWithRole(role: "owner" | "admin" | "member") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("companyRole", role);
    await next();
  });
  return app;
}

describe("requireAdmin", () => {
  test("blocks members from admin-only routes like the SLA settings update", async () => {
    const app = appWithRole("member");
    app.patch("/companies/:id", requireAdmin(), (c) => c.json({ ok: true }));
    const response = await app.request("/companies/1", { method: "PATCH" });
    expect(response.status).toBe(403);
  });

  test("allows admins to reach admin-only routes", async () => {
    const app = appWithRole("admin");
    app.patch("/companies/:id", requireAdmin(), (c) => c.json({ ok: true }));
    const response = await app.request("/companies/1", { method: "PATCH" });
    expect(response.status).toBe(200);
  });

  test("allows owners to reach admin-only routes", async () => {
    const app = appWithRole("owner");
    app.patch("/companies/:id", requireAdmin(), (c) => c.json({ ok: true }));
    const response = await app.request("/companies/1", { method: "PATCH" });
    expect(response.status).toBe(200);
  });
});

describe("requireOwner", () => {
  test("blocks admins from owner-only routes", async () => {
    const app = appWithRole("admin");
    app.patch("/companies/:id/status", requireOwner(), (c) =>
      c.json({ ok: true }),
    );
    const response = await app.request("/companies/1/status", {
      method: "PATCH",
    });
    expect(response.status).toBe(403);
  });

  test("allows owners through owner-only routes", async () => {
    const app = appWithRole("owner");
    app.patch("/companies/:id/status", requireOwner(), (c) =>
      c.json({ ok: true }),
    );
    const response = await app.request("/companies/1/status", {
      method: "PATCH",
    });
    expect(response.status).toBe(200);
  });
});
