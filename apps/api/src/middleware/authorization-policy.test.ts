import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  getEffectivePermissions,
  type MemberPermissions,
  PERMISSIONS,
  ROLE_PRESETS,
} from "../services/permission.service.js";
import { requirePermission } from "./permission.js";
import {
  requireContactVisibility,
  requireMessageVisibility,
} from "./resource-visibility.js";

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

function messageVisibilityDatabase(assignedTo: string | null) {
  return {
    selectFrom(table: string) {
      const conditions = new Map<string, unknown>();
      const query = {
        select: () => query,
        where(column: string, _operator: string, value: unknown) {
          conditions.set(column, value);
          return query;
        },
        async executeTakeFirst() {
          if (table === "messages") {
            return conditions.get("id") === "media-message"
              ? { contact_id: "media-contact" }
              : undefined;
          }
          if (table === "contact_assignments") {
            return conditions.get("contact_id") === "media-contact" &&
              conditions.get("assigned_to") === assignedTo &&
              assignedTo !== null
              ? { id: "assignment" }
              : undefined;
          }
          return undefined;
        },
      };
      return query;
    },
  };
}

function mediaGuardApp(
  userId: string,
  assignedTo: string | null,
  canViewAllChats = false,
) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set("user", {
      id: userId,
      email: `${userId}@example.com`,
      name: userId,
      emailVerifiedAt: null,
    });
    context.set(
      "companyPermissions",
      permissionsWith(PERMISSIONS.CAN_VIEW_ALL_CHATS, canViewAllChats),
    );
    context.set("tenantDb", messageVisibilityDatabase(assignedTo) as never);
    await next();
  });
  app.get(
    "/media/messages/:messageId",
    requireMessageVisibility("messageId"),
    (context) => context.json({ mediaUrl: "authorized" }),
  );
  return app;
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
    expect(getEffectivePermissions("admin").can_manage_team).toBe(true);
    expect(
      getEffectivePermissions("member", { can_export: true }).can_export,
    ).toBe(true);
  });

  test("member effective permissions come from the shared preset: full chat/messaging and contact management, nothing else", () => {
    const permissions = getEffectivePermissions("member");

    expect(permissions).toEqual(ROLE_PRESETS.member);
    expect(permissions).toEqual({
      can_view_all_chats: true,
      can_send_messages: true,
      can_send_bulk_messages: true,
      can_assign_contacts: true,
      can_manage_team: false,
      can_invite: false,
      can_manage_connections: false,
      can_view_dashboard: false,
      can_view_audit: false,
      can_export: false,
      can_delete: false,
    });
  });

  test("a per-member override still narrows a member default", () => {
    expect(
      getEffectivePermissions("member", { can_send_bulk_messages: false }),
    ).toMatchObject({
      can_send_bulk_messages: false,
      can_view_all_chats: true,
    });
  });

  test("media access allows the active contact assignee", async () => {
    const response = await mediaGuardApp("agent-a", "agent-a").request(
      "/media/messages/media-message",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mediaUrl: "authorized" });
  });

  test("media access hides another assignee's message", async () => {
    const response = await mediaGuardApp("agent-a", "agent-b").request(
      "/media/messages/media-message",
    );
    expect(response.status).toBe(404);
  });

  test("media access honors the can_view_all_chats role policy", async () => {
    const response = await mediaGuardApp("supervisor", "agent-b", true).request(
      "/media/messages/media-message",
    );
    expect(response.status).toBe(200);
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
