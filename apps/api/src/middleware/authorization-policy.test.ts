import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  getEffectivePermissions,
  type MemberPermissions,
  PERMISSIONS,
  ROLE_PRESETS,
} from "../services/permission.service.js";
import { requirePermission } from "./permission.js";
import { requireContactVisibility } from "./resource-visibility.js";

function permissionsWith(
  permission: keyof MemberPermissions,
  value: boolean,
): MemberPermissions {
  return {
    ...ROLE_PRESETS.member,
    can_send_messages: false,
    [permission]: value,
  };
}

function emptyAssignmentDatabase() {
  const builder = {
    selectFrom: () => builder,
    select: () => builder,
    where: () => builder,
    executeTakeFirst: async () => undefined,
  };
  return builder;
}

describe("authorization policy integration", () => {
  test("every granular permission denies disabled members and allows enabled members", async () => {
    for (const permission of Object.values(PERMISSIONS)) {
      for (const allowed of [false, true]) {
        const app = new Hono();
        app.use("*", async (context, next) => {
          context.set(
            "companyPermissions",
            permissionsWith(permission, allowed),
          );
          await next();
        });
        app.get("/resource", requirePermission(permission), (context) =>
          context.json({ ok: true }),
        );
        const response = await app.request("/resource");
        expect(response.status, `${permission}=${allowed}`).toBe(
          allowed ? 200 : 403,
        );
      }
    }
  });

  test("missing company membership never inherits role permissions", async () => {
    const app = new Hono();
    app.get(
      "/member-resource",
      requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
      (context) => context.json({ ok: true }),
    );
    expect((await app.request("/member-resource")).status).toBe(403);
  });

  test("role presets and custom overrides resolve consistently", () => {
    expect(Object.values(getEffectivePermissions("owner")).every(Boolean)).toBe(
      true,
    );
    expect(getEffectivePermissions("admin").can_manage_team).toBe(false);
    expect(
      getEffectivePermissions("member", { can_export: true }).can_export,
    ).toBe(true);
  });

  test("restricted members receive 404 for another assignee's contact", async () => {
    const app = new Hono();
    let handlerCalled = false;
    app.use("*", async (context, next) => {
      context.set("user", {
        id: "restricted-user",
        email: "restricted@example.com",
        name: "Restricted",
        emailVerifiedAt: null,
      });
      context.set(
        "companyPermissions",
        permissionsWith(PERMISSIONS.CAN_VIEW_ALL_CHATS, false),
      );
      context.set("tenantDb", emptyAssignmentDatabase() as never);
      await next();
    });
    app.get("/contacts/:id", requireContactVisibility(), (context) => {
      handlerCalled = true;
      return context.json({ ok: true });
    });
    const response = await app.request(`/contacts/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
    expect(handlerCalled).toBe(false);
  });
});
