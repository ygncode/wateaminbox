import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  legacyMessageSendRemoved,
  MESSAGE_SEND_SURFACES,
  requireMessageSendPermission,
} from "../middleware/message-send-policy.js";
import type { MemberPermissions } from "../services/permission.service.js";
import { routes } from "./index.js";

const requestPath = (path: string) =>
  path
    .replace(":id", crypto.randomUUID())
    .replace(":connectionId", crypto.randomUUID());

describe("message-send route policy", () => {
  test("attaches the shared permission middleware to every send surface", () => {
    for (const path of MESSAGE_SEND_SURFACES) {
      const routeHandlers = routes.routes
        .filter((route) => route.method === "POST" && route.path === path)
        .map((route) => route.handler);

      expect(routeHandlers, `missing POST route ${path}`).not.toHaveLength(0);
      expect(
        routeHandlers.includes(requireMessageSendPermission),
        `missing can_send_messages policy on POST ${path}`,
      ).toBe(true);
    }
  });

  test("returns 403 on every send surface when sending is disabled", async () => {
    for (const path of MESSAGE_SEND_SURFACES) {
      const app = new Hono();
      let handlerCalled = false;

      app.use("*", async (c, next) => {
        c.set("companyPermissions", {
          can_send_messages: false,
        } as MemberPermissions);
        await next();
      });
      app.post(path, requireMessageSendPermission, (c) => {
        handlerCalled = true;
        return c.json({ success: true });
      });

      const response = await app.request(requestPath(path), { method: "POST" });
      expect(response.status, path).toBe(403);
      expect(handlerCalled, path).toBe(false);
    }
  });

  test("legacy JID-based send surfaces direct authorized clients to the canonical endpoint", async () => {
    const app = new Hono();
    app.post("/legacy-send", legacyMessageSendRemoved);

    const response = await app.request("/legacy-send", { method: "POST" });
    expect(response.status).toBe(410);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Link")).toContain("/api/messages");
    expect(await response.json()).toEqual({
      error: "This message-send endpoint has been removed",
      replacement: "/api/messages",
    });
  });
});
