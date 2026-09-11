import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "./validator.js";

const body = z.object({
  name: z.string().min(1, "Name is required"),
  deviceInfo: z
    .object({ deviceName: z.string().max(5, "Device name is too long") })
    .optional(),
});

function appWithValidator() {
  const app = new Hono();
  app.post("/json", zValidator("json", body), (c) =>
    c.json({ data: c.req.valid("json") }),
  );
  app.get(
    "/query",
    zValidator("query", z.object({ limit: z.coerce.number().max(10) })),
    (c) => c.json({ data: c.req.valid("query") }),
  );
  app.post(
    "/custom",
    zValidator("json", body, (result, c) => {
      if (!result.success) {
        return c.json({ error: "invalid_request" }, 400);
      }
    }),
    (c) => c.json({ data: c.req.valid("json") }),
  );
  return app;
}

describe("zValidator wrapper", () => {
  test("formats a rejected body the way the rest of the API does", async () => {
    const response = await appWithValidator().request("/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(response.status).toBe(400);
    // The default two-argument zValidator answered with
    // `{ success: false, error: { issues: [...], name: "ZodError" } }`, a shape
    // no other endpoint produces.
    expect(await response.json()).toEqual({
      error: "Validation Error",
      details: [{ field: "name", message: "Name is required" }],
    });
  });

  test("joins nested paths into dotted field names", async () => {
    const response = await appWithValidator().request("/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "ok",
        deviceInfo: { deviceName: "far too long" },
      }),
    });

    expect(await response.json()).toEqual({
      error: "Validation Error",
      details: [
        { field: "deviceInfo.deviceName", message: "Device name is too long" },
      ],
    });
  });

  test("covers query validation as well as bodies", async () => {
    const response = await appWithValidator().request("/query?limit=99");

    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: string;
      details: { field: string }[];
    };
    expect(payload.error).toBe("Validation Error");
    expect(payload.details.map((detail) => detail.field)).toEqual(["limit"]);
  });

  test("leaves a valid request to the handler", async () => {
    const response = await appWithValidator().request("/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { name: "Ada" } });
  });

  test("keeps a route that supplies its own hook in control", async () => {
    const response = await appWithValidator().request("/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    // OAuth answers with `invalid_request`/`error_description`, which the
    // OAuth error contract requires, so the wrapper must not override it.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
