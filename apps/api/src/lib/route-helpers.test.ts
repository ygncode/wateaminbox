import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ValidationError } from "./errors.js";
import { extractSlaThresholdOverride } from "./route-helpers.js";

function buildApp() {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    throw error;
  });
  app.get("/", (c) => {
    const value = extractSlaThresholdOverride(c);
    return c.json({ value: value ?? null });
  });
  return app;
}

describe("extractSlaThresholdOverride", () => {
  test("returns undefined when no slaThreshold query param is provided", async () => {
    const response = await buildApp().request("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: null });
  });

  test("accepts an in-range integer override", async () => {
    const response = await buildApp().request("/?slaThreshold=90");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: 90 });
  });

  test("rejects a threshold below the minimum", async () => {
    const response = await buildApp().request("/?slaThreshold=0");
    expect(response.status).toBe(400);
  });

  test("rejects a threshold above the maximum", async () => {
    const response = await buildApp().request("/?slaThreshold=1441");
    expect(response.status).toBe(400);
  });

  test("rejects a non-integer threshold", async () => {
    const response = await buildApp().request("/?slaThreshold=30.5");
    expect(response.status).toBe(400);
  });

  test("rejects a non-numeric threshold", async () => {
    const response = await buildApp().request("/?slaThreshold=abc");
    expect(response.status).toBe(400);
  });
});
