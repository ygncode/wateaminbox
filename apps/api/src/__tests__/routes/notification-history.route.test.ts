/**
 * Unit tests for notification history routes
 *
 * Tests the in-app notification center API endpoints:
 * - GET /notifications - List notifications
 * - GET /notifications/count - Get unread count
 * - GET /notifications/:id - Get single notification
 * - POST /notifications - Create notification
 * - PATCH /notifications/:id/read - Mark as read
 * - POST /notifications/read-all - Mark all as read
 * - DELETE /notifications/:id - Delete notification
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockNotificationHistory, createMockQueryBuilder } from "../mocks";

// Create mock tenant db for notification history
function createMockTenantDb() {
  let notifications: unknown[] = [];
  let insertedNotif: unknown = null;
  let updatedNotif: unknown = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "notification_history") {
        const builder: Record<string, unknown> = {};
        let filtered = [...notifications];

        const chainMethods = [
          "selectAll",
          "select",
          "where",
          "orderBy",
          "limit",
          "offset",
        ];

        chainMethods.forEach((method) => {
          builder[method] = mock((arg1?: unknown, _arg2?: unknown, arg3?: unknown) => {
            if (method === "where" && arg1 === "user_id") {
              const userId = arg3 as string;
              filtered = (notifications as Array<{ user_id: string }>).filter(
                (n) => n.user_id === userId
              );
            }
            if (method === "where" && arg1 === "is_read") {
              const isRead = arg3 as boolean;
              filtered = (filtered as Array<{ is_read: boolean }>).filter(
                (n) => n.is_read === isRead
              );
            }
            return builder;
          });
        });

        builder.execute = mock(() => Promise.resolve(filtered));
        builder.executeTakeFirst = mock(() => {
          if (filtered.length > 0) return Promise.resolve(filtered[0]);
          return Promise.resolve(undefined);
        });

        return builder;
      }
      return createMockQueryBuilder();
    }),
    insertInto: mock((table: string) => {
      if (table === "notification_history") {
        const builder: Record<string, unknown> = {};
        builder.values = mock((values: unknown) => {
          insertedNotif = {
            id: "new-notif-123",
            ...values as object,
            is_read: false,
            read_at: null,
            created_at: new Date(),
          };
          return builder;
        });
        builder.returningAll = mock(() => builder);
        builder.executeTakeFirst = mock(() => Promise.resolve(insertedNotif));
        return builder;
      }
      return createMockQueryBuilder();
    }),
    updateTable: mock((table: string) => {
      if (table === "notification_history") {
        const builder: Record<string, unknown> = {};
        let targetId: string | null = null;
        let updateData: Record<string, unknown> = {};

        builder.set = mock((data: unknown) => {
          updateData = data as Record<string, unknown>;
          return builder;
        });
        builder.where = mock((col: string, _op: string, val: unknown) => {
          if (col === "id") targetId = val as string;
          return builder;
        });
        builder.returningAll = mock(() => builder);
        builder.executeTakeFirst = mock(() => {
          const found = (notifications as Array<{ id: string }>).find(
            (n) => n.id === targetId
          );
          if (found) {
            updatedNotif = { ...found, ...updateData };
            return Promise.resolve(updatedNotif);
          }
          return Promise.resolve(undefined);
        });
        return builder;
      }
      return createMockQueryBuilder();
    }),
    deleteFrom: mock((table: string) => {
      if (table === "notification_history") {
        const builder: Record<string, unknown> = {};
        let targetId: string | null = null;

        builder.where = mock((col: string, _op: string, val: unknown) => {
          if (col === "id") targetId = val as string;
          return builder;
        });
        builder.executeTakeFirst = mock(() => {
          const found = (notifications as Array<{ id: string }>).find(
            (n) => n.id === targetId
          );
          return Promise.resolve({
            numDeletedRows: found ? BigInt(1) : BigInt(0),
          });
        });
        return builder;
      }
      return createMockQueryBuilder();
    }),
    setNotifications: (notifs: unknown[]) => {
      notifications = notifs;
    },
    getInsertedNotif: () => insertedNotif,
    getUpdatedNotif: () => updatedNotif,
  };

  return mockDb;
}

describe("GET /notifications - List notifications", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.get("/notifications", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const user = c.get("user") as { id: string };

      const notifications = await tenantDb
        .selectFrom("notification_history")
        .selectAll()
        .where("user_id", "=", user.id)
        .orderBy("created_at", "desc")
        .limit(20)
        .offset(0)
        .execute();

      const unreadNotifs = await tenantDb
        .selectFrom("notification_history")
        .selectAll()
        .where("user_id", "=", user.id)
        .where("is_read", "=", false)
        .execute();

      return c.json({
        data: (notifications as Array<Record<string, unknown>>).map((n) => ({
          id: n.id,
          userId: n.user_id,
          notificationType: n.notification_type,
          title: n.title,
          message: n.message,
          actionUrl: n.action_url,
          metadata: n.metadata,
          isRead: n.is_read,
          readAt: n.read_at,
          createdAt: n.created_at,
        })),
        meta: {
          total: notifications.length,
          unreadCount: unreadNotifs.length,
          limit: 20,
          offset: 0,
        },
      });
    });
  });

  it("should return empty list when no notifications", async () => {
    mockTenantDb.setNotifications([]);

    const response = await app.request("/notifications", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toEqual([]);
    expect(data.meta.total).toBe(0);
    expect(data.meta.unreadCount).toBe(0);
  });

  it("should return list of notifications", async () => {
    const notifs = [
      createMockNotificationHistory({ id: "notif-1", title: "Message 1" }),
      createMockNotificationHistory({
        id: "notif-2",
        title: "Message 2",
        is_read: true,
      }),
    ];
    mockTenantDb.setNotifications(notifs);

    const response = await app.request("/notifications", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.length).toBe(2);
    expect(data.meta.unreadCount).toBe(1);
  });
});

describe("GET /notifications/count - Get unread count", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.get("/notifications/count", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const user = c.get("user") as { id: string };

      const unreadNotifs = await tenantDb
        .selectFrom("notification_history")
        .selectAll()
        .where("user_id", "=", user.id)
        .where("is_read", "=", false)
        .execute();

      return c.json({
        data: {
          unreadCount: unreadNotifs.length,
        },
      });
    });
  });

  it("should return 0 when no unread notifications", async () => {
    mockTenantDb.setNotifications([
      createMockNotificationHistory({ is_read: true }),
    ]);

    const response = await app.request("/notifications/count", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.unreadCount).toBe(0);
  });

  it("should return count of unread notifications", async () => {
    mockTenantDb.setNotifications([
      createMockNotificationHistory({ id: "1", is_read: false }),
      createMockNotificationHistory({ id: "2", is_read: false }),
      createMockNotificationHistory({ id: "3", is_read: true }),
    ]);

    const response = await app.request("/notifications/count", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.unreadCount).toBe(2);
  });
});

describe("POST /notifications - Create notification", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.post("/notifications", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const user = c.get("user") as { id: string };
      const body = await c.req.json();

      if (!body.notificationType || !body.title) {
        return c.json({ error: "notificationType and title are required" }, 400);
      }

      const notification = await tenantDb
        .insertInto("notification_history")
        .values({
          user_id: user.id,
          notification_type: body.notificationType,
          title: body.title,
          message: body.message || null,
          action_url: body.actionUrl || null,
          metadata: body.metadata || null,
        })
        .returningAll()
        .executeTakeFirst();

      if (!notification) {
        return c.json({ error: "Failed to create notification" }, 500);
      }

      const n = notification as Record<string, unknown>;
      return c.json(
        {
          data: {
            id: n.id,
            userId: n.user_id,
            notificationType: n.notification_type,
            title: n.title,
            message: n.message,
            actionUrl: n.action_url,
            metadata: n.metadata,
            isRead: n.is_read,
            readAt: n.read_at,
            createdAt: n.created_at,
          },
        },
        201
      );
    });
  });

  it("should create a notification", async () => {
    const response = await app.request("/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationType: "message",
        title: "New message",
        message: "You have a new message",
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.data.id).toBe("new-notif-123");
    expect(data.data.title).toBe("New message");
    expect(data.data.notificationType).toBe("message");
    expect(data.data.isRead).toBe(false);
  });

  it("should return 400 if required fields missing", async () => {
    const response = await app.request("/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("notificationType and title are required");
  });
});

describe("PATCH /notifications/:id/read - Mark as read", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.patch("/notifications/:id/read", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const user = c.get("user") as { id: string };
      const notificationId = c.req.param("id");

      const updated = await tenantDb
        .updateTable("notification_history")
        .set({
          is_read: true,
          read_at: new Date(),
        })
        .where("id", "=", notificationId)
        .where("user_id", "=", user.id)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        return c.json({ error: "Notification not found" }, 404);
      }

      const n = updated as Record<string, unknown>;
      return c.json({
        data: {
          id: n.id,
          userId: n.user_id,
          notificationType: n.notification_type,
          title: n.title,
          isRead: n.is_read,
          readAt: n.read_at,
        },
      });
    });
  });

  it("should mark notification as read", async () => {
    const notif = createMockNotificationHistory({
      id: "notif-123",
      is_read: false,
    });
    mockTenantDb.setNotifications([notif]);

    const response = await app.request("/notifications/notif-123/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.isRead).toBe(true);
    expect(data.data.readAt).toBeDefined();
  });

  it("should return 404 for non-existent notification", async () => {
    mockTenantDb.setNotifications([]);

    const response = await app.request("/notifications/non-existent/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Notification not found");
  });
});

describe("DELETE /notifications/:id - Delete notification", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.delete("/notifications/:id", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const user = c.get("user") as { id: string };
      const notificationId = c.req.param("id");

      const result = await tenantDb
        .deleteFrom("notification_history")
        .where("id", "=", notificationId)
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      const deleted = Number((result as { numDeletedRows: bigint }).numDeletedRows) > 0;

      if (!deleted) {
        return c.json({ error: "Notification not found" }, 404);
      }

      return c.json({
        data: { deleted: true },
      });
    });
  });

  it("should delete a notification", async () => {
    const notif = createMockNotificationHistory({ id: "notif-123" });
    mockTenantDb.setNotifications([notif]);

    const response = await app.request("/notifications/notif-123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.deleted).toBe(true);
  });

  it("should return 404 for non-existent notification", async () => {
    mockTenantDb.setNotifications([]);

    const response = await app.request("/notifications/non-existent", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Notification not found");
  });
});
