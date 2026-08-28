import { describe, expect, test } from "bun:test";
import {
  analyticsRoutes,
  requireConversationAnalyticsPermission,
} from "./analytics.js";
import { conversationRoutes } from "./index.js";

const ANALYTICS_PATHS = [
  "/stats/resolution",
  "/stats/resolution-trend",
  "/stats/resolution-breaches",
  "/stats/resolution-team",
] as const;

describe("conversation route policy", () => {
  test("protects every aggregate endpoint with dashboard permission", () => {
    const permissionIndex = analyticsRoutes.routes.findIndex(
      (route) => route.handler === requireConversationAnalyticsPermission,
    );
    expect(permissionIndex).toBeGreaterThanOrEqual(0);
    expect(analyticsRoutes.routes[permissionIndex]?.path).toBe("/stats/*");

    for (const path of ANALYTICS_PATHS) {
      const endpointIndex = analyticsRoutes.routes.findIndex(
        (route) => route.method === "GET" && route.path === path,
      );
      expect(endpointIndex, `missing GET ${path}`).toBeGreaterThanOrEqual(0);
      expect(
        permissionIndex,
        `dashboard permission must run before GET ${path}`,
      ).toBeLessThan(endpointIndex);
    }
  });

  test("mounts aggregate endpoints before contact visibility middleware", () => {
    const visibilityIndex = conversationRoutes.routes.findIndex(
      (route) => route.method === "ALL" && route.path === "/:id/*",
    );
    expect(visibilityIndex).toBeGreaterThanOrEqual(0);

    for (const path of ANALYTICS_PATHS) {
      const endpointIndex = conversationRoutes.routes.findIndex(
        (route) => route.method === "GET" && route.path === path,
      );
      expect(
        endpointIndex,
        `missing mounted GET ${path}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        endpointIndex,
        `contact visibility must not treat the /stats prefix as a contact ID`,
      ).toBeLessThan(visibilityIndex);
    }

    const resourceIndex = conversationRoutes.routes.findIndex(
      (route) => route.method === "GET" && route.path === "/:id/state",
    );
    expect(resourceIndex).toBeGreaterThan(visibilityIndex);
  });
});
