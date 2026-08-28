import { describe, expect, test } from "bun:test";
import { routes } from "./index.js";

const REMOVED_ROUTES = [
  ["POST", "/actions/messages/send"],
  ["POST", "/whatsapp/send"],
  ["POST", "/whatsapp/connections/:connectionId/send"],
  ["GET", "/whatsapp/connection"],
  ["DELETE", "/groups/:id/participants/:participantJid"],
  ["POST", "/groups/:id/participants/:participantJid/demote"],
  ["POST", "/groups/:id/participants/:participantJid/promote"],
] as const;

const REPLACEMENT_ROUTES = [
  ["POST", "/messages"],
  ["GET", "/whatsapp/connections/:connectionId"],
  ["POST", "/groups/:id/participants/remove"],
  ["POST", "/groups/:id/participants/demote"],
  ["POST", "/groups/:id/participants/promote"],
] as const;

const hasRoute = (method: string, path: string) =>
  routes.routes.some((route) => route.method === method && route.path === path);

describe("legacy API removal", () => {
  test("does not register removed aliases and tombstones", () => {
    for (const [method, path] of REMOVED_ROUTES) {
      expect(hasRoute(method, path), `${method} ${path}`).toBe(false);
    }
    expect(
      hasRoute("DELETE", "/groups/:id/*"),
      "obsolete wildcard guard for the removed DELETE alias",
    ).toBe(false);
  });

  test("keeps each supported replacement registered", () => {
    for (const [method, path] of REPLACEMENT_ROUTES) {
      expect(hasRoute(method, path), `${method} ${path}`).toBe(true);
    }
  });
});
