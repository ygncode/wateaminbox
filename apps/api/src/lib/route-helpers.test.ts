import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ValidationError } from "./errors.js";
import {
  extractDayWindow,
  extractSlaThresholdOverride,
  MAX_ANALYTICS_WINDOW_DAYS,
} from "./route-helpers.js";

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

function buildDayWindowApp() {
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
  app.get("/", (c) => c.json({ days: extractDayWindow(c) }));
  return app;
}

describe("extractDayWindow", () => {
  test("defaults when the parameter is absent or blank", async () => {
    expect(await (await buildDayWindowApp().request("/")).json()).toEqual({
      days: 30,
    });
    expect(await (await buildDayWindowApp().request("/?days=")).json()).toEqual(
      { days: 30 },
    );
  });

  test("accepts an in-range integer", async () => {
    const response = await buildDayWindowApp().request("/?days=7");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ days: 7 });
  });

  test("rejects a non-numeric window as a 400 rather than a 500", async () => {
    // parseInt("abc") is NaN, which used to flow into date arithmetic and reach
    // PostgreSQL as an invalid timestamp.
    const response = await buildDayWindowApp().request("/?days=abc");
    expect(response.status).toBe(400);
  });

  test.each([
    "0",
    "-1",
    "1.5",
    "1e3",
    "Infinity",
  ])("rejects %p", async (value) => {
    const response = await buildDayWindowApp().request(`/?days=${value}`);
    expect(response.status).toBe(400);
  });

  test("rejects a window wide enough to scan the whole message history", async () => {
    const response = await buildDayWindowApp().request(
      `/?days=${MAX_ANALYTICS_WINDOW_DAYS + 1}`,
    );
    expect(response.status).toBe(400);
    expect(
      (await buildDayWindowApp().request(`/?days=${MAX_ANALYTICS_WINDOW_DAYS}`))
        .status,
    ).toBe(200);
  });
});
