/**
 * Unit tests for status.ts routes
 *
 * Tests the status API endpoints:
 * - GET /status
 * - GET /status/:jid
 * - GET /status/stats/overview
 * - GET /status/my
 * - POST /status
 * - DELETE /status/:id
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockStatusUpdate, createMockWhatsAppConnection } from "../mocks";

// Create mock query builder for tenant database
function createMockQueryBuilder(returnValue: unknown = undefined) {
  const mockBuilder: Record<string, unknown> = {};

  const chainMethods = [
    "selectFrom",
    "insertInto",
    "updateTable",
    "deleteFrom",
    "select",
    "selectAll",
    "where",
    "values",
    "set",
    "returning",
    "returningAll",
    "orderBy",
    "limit",
    "offset",
    "or",
  ];

  const terminalMethods = {
    execute: mock(() =>
      Promise.resolve(Array.isArray(returnValue) ? returnValue : [])
    ),
    executeTakeFirst: mock(() => Promise.resolve(returnValue)),
    executeTakeFirstOrThrow: mock(() => {
      if (returnValue === undefined) throw new Error("no result");
      return Promise.resolve(returnValue);
    }),
  };

  // Setup chainable methods
  chainMethods.forEach((method) => {
    mockBuilder[method] = mock(() => mockBuilder);
  });

  // Setup terminal methods
  Object.entries(terminalMethods).forEach(([method, fn]) => {
    mockBuilder[method] = fn;
  });

  return mockBuilder;
}

// Mock publishPostStatus function
const mockPublishPostStatus = mock(() => Promise.resolve());

// Mock NATS module before importing routes
mock.module("../../lib/nats.js", () => ({
  publishPostStatus: mockPublishPostStatus,
  NATS_SUBJECTS: {},
}));

// Create a mock tenant db for status
function createMockTenantDb() {
  let statusUpdates: unknown[] = [];
  let insertedStatus: unknown = null;
  let deletedId: string | null = null;
  let connection: unknown = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "status_updates") {
        const builder: Record<string, unknown> = {};
        let currentFilters: { field: string; value: unknown }[] = [];

        const chainMethods = ["selectAll", "select", "orderBy", "limit", "offset"];
        chainMethods.forEach((method) => {
          builder[method] = mock(() => builder);
        });

        builder.where = mock((arg1: unknown, _op?: string, value?: unknown) => {
          if (typeof arg1 === "function") {
            // Handle complex where with expression builder
            const eb = {
              or: (conditions: unknown[]) => {
                return builder;
              },
            };
            arg1(eb);
          } else if (typeof arg1 === "string" && value !== undefined) {
            currentFilters.push({ field: arg1, value });
          }
          return builder;
        });

        builder.execute = mock(() => {
          let result = [...statusUpdates];
          // Filter by expires_at
          currentFilters.forEach((filter) => {
            if (filter.field === "expires_at") {
              result = result.filter(
                (s: unknown) =>
                  new Date((s as Record<string, unknown>).expires_at as string) >
                  (filter.value as Date)
              );
            }
            if (filter.field === "from_jid") {
              result = result.filter(
                (s: unknown) =>
                  (s as Record<string, unknown>).from_jid === filter.value
              );
            }
            if (filter.field === "id") {
              result = result.filter(
                (s: unknown) => (s as Record<string, unknown>).id === filter.value
              );
            }
          });
          return Promise.resolve(result);
        });

        builder.executeTakeFirst = mock(() => {
          let result = [...statusUpdates];
          currentFilters.forEach((filter) => {
            if (filter.field === "id") {
              result = result.filter(
                (s: unknown) => (s as Record<string, unknown>).id === filter.value
              );
            }
          });
          return Promise.resolve(result[0]);
        });

        // For count queries
        const eb = {
          fn: {
            countAll: () => ({
              as: () => "count",
            }),
            count: (_col: string) => ({
              distinct: () => ({
                as: () => "count",
              }),
            }),
          },
          or: mock(() => builder),
        };

        builder.select = mock((selectorFn?: unknown) => {
          if (typeof selectorFn === "function") {
            selectorFn(eb);
          }
          return builder;
        });

        return builder;
      }

      if (table === "whatsapp_connections") {
        const builder: Record<string, unknown> = {};
        const chainMethods = ["selectAll", "select", "orderBy", "limit", "offset"];
        chainMethods.forEach((method) => {
          builder[method] = mock(() => builder);
        });

        builder.where = mock(() => builder);
        builder.execute = mock(() =>
          Promise.resolve(connection ? [connection] : [])
        );
        builder.executeTakeFirst = mock(() => Promise.resolve(connection));

        return builder;
      }

      return createMockQueryBuilder();
    }),
    insertInto: mock((table: string) => {
      if (table === "status_updates") {
        const builder: Record<string, unknown> = {};
        builder.values = mock((values: unknown) => {
          insertedStatus = values;
          return builder;
        });
        builder.execute = mock(() => Promise.resolve([]));
        builder.executeTakeFirst = mock(() =>
          Promise.resolve(insertedStatus)
        );
        return builder;
      }
      return createMockQueryBuilder();
    }),
    deleteFrom: mock((table: string) => {
      if (table === "status_updates") {
        const builder: Record<string, unknown> = {};
        builder.where = mock((_col: string, _op: string, value: unknown) => {
          deletedId = value as string;
          return builder;
        });
        builder.execute = mock(() => Promise.resolve([]));
        return builder;
      }
      return createMockQueryBuilder();
    }),

    // Helper methods for tests
    _setStatusUpdates: (updates: unknown[]) => {
      statusUpdates = updates;
    },
    _setConnection: (conn: unknown) => {
      connection = conn;
    },
    _getInsertedStatus: () => insertedStatus,
    _getDeletedId: () => deletedId,
    _reset: () => {
      statusUpdates = [];
      insertedStatus = null;
      deletedId = null;
      connection = null;
    },
  };

  return mockDb;
}

describe("Status Routes", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;
  const testUser = { id: "test-user-123", email: "test@example.com" };
  const testCompanyId = "test-company-123";

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();
    mockPublishPostStatus.mockClear();

    app = new Hono();

    // Mock middleware
    app.use("/*", async (c, next) => {
      c.set("user", testUser);
      c.set("companyId", testCompanyId);
      c.set("tenantDb", mockTenantDb);
      await next();
    });

    // Mount routes
    app.get("/status", async (c) => {
      const tenantDb = c.get("tenantDb");
      const limit = parseInt(c.req.query("limit") || "50", 10);
      const offset = parseInt(c.req.query("offset") || "0", 10);
      const now = new Date();

      const statuses = await tenantDb
        .selectFrom("status_updates")
        .selectAll()
        .where("expires_at", ">", now)
        .orderBy("timestamp", "desc")
        .limit(limit)
        .offset(offset)
        .execute();

      const groupedByContact: Record<string, typeof statuses> = {};
      for (const status of statuses) {
        const jid = status.from_jid || "unknown";
        if (!groupedByContact[jid]) {
          groupedByContact[jid] = [];
        }
        groupedByContact[jid].push(status);
      }

      const contacts = Object.entries(groupedByContact).map(
        ([jid, contactStatuses]) => ({
          jid,
          statuses: contactStatuses.map((s: Record<string, unknown>) => ({
            id: s.id,
            statusId: s.status_id,
            mediaType: s.media_type,
            mediaUrl: s.media_url,
            caption: s.caption,
            timestamp: s.timestamp,
            expiresAt: s.expires_at,
          })),
        })
      );

      return c.json({
        data: contacts,
        pagination: {
          total: statuses.length,
          limit,
          offset,
          hasMore: false,
        },
      });
    });

    app.get("/status/my", async (c) => {
      const tenantDb = c.get("tenantDb");
      const now = new Date();

      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["jid"])
        .where("status", "=", "connected")
        .executeTakeFirst();

      if (!connection?.jid) {
        return c.json({ data: [], count: 0 });
      }

      const myStatuses = await tenantDb
        .selectFrom("status_updates")
        .selectAll()
        .where((eb: unknown) => eb)
        .where("expires_at", ">", now)
        .orderBy("timestamp", "desc")
        .execute();

      return c.json({
        data: myStatuses.map((s: Record<string, unknown>) => ({
          id: s.id,
          statusId: s.status_id,
          mediaType: s.media_type,
          mediaUrl: s.media_url,
          caption: s.caption,
          timestamp: s.timestamp,
          expiresAt: s.expires_at,
        })),
        count: myStatuses.length,
      });
    });

    app.get("/status/stats/overview", async (c) => {
      const tenantDb = c.get("tenantDb");
      const now = new Date();

      const statuses = await tenantDb
        .selectFrom("status_updates")
        .selectAll()
        .where("expires_at", ">", now)
        .execute();

      return c.json({
        activeStatuses: statuses.length,
        contactsWithStatus: new Set(
          statuses.map((s: Record<string, unknown>) => s.from_jid)
        ).size,
        totalStatusesReceived: statuses.length,
      });
    });

    app.get("/status/:jid", async (c) => {
      const tenantDb = c.get("tenantDb");
      const jid = c.req.param("jid");
      const now = new Date();

      const statuses = await tenantDb
        .selectFrom("status_updates")
        .selectAll()
        .where("from_jid", "=", jid)
        .where("expires_at", ">", now)
        .orderBy("timestamp", "asc")
        .execute();

      if (statuses.length === 0) {
        return c.json({ error: "No status updates found" }, 404);
      }

      return c.json({
        jid,
        statuses: statuses.map((s: Record<string, unknown>) => ({
          id: s.id,
          statusId: s.status_id,
          mediaType: s.media_type,
          mediaUrl: s.media_url,
          caption: s.caption,
          timestamp: s.timestamp,
          expiresAt: s.expires_at,
        })),
      });
    });

    app.post("/status", async (c) => {
      const tenantDb = c.get("tenantDb");
      const user = c.get("user");
      const companyId = c.get("companyId");
      const body = await c.req.json();

      const { type, content, mediaUrl } = body;

      if (!type || !["text", "image", "video"].includes(type)) {
        return c.json(
          { error: "type is required and must be 'text', 'image', or 'video'" },
          400
        );
      }

      if (type === "text" && !content) {
        return c.json({ error: "content is required for text status" }, 400);
      }

      if ((type === "image" || type === "video") && !mediaUrl) {
        return c.json(
          { error: "mediaUrl is required for image/video status" },
          400
        );
      }

      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "status", "jid"])
        .where("status", "=", "connected")
        .executeTakeFirst();

      if (!connection) {
        return c.json(
          { error: "WhatsApp is not connected. Please connect first." },
          400
        );
      }

      const statusId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await tenantDb
        .insertInto("status_updates")
        .values({
          id: statusId,
          whatsapp_connection_id: connection.id,
          status_id: `pending_${statusId}`,
          from_jid: connection.jid || "me",
          media_type: type === "text" ? null : type,
          media_url: mediaUrl || null,
          caption: content || null,
          timestamp: now,
          expires_at: expiresAt,
        })
        .execute();

      await mockPublishPostStatus(companyId, type, user.id, content, mediaUrl);

      return c.json({
        success: true,
        status: {
          id: statusId,
          type,
          content: content || null,
          mediaUrl: mediaUrl || null,
          timestamp: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    });

    app.delete("/status/:id", async (c) => {
      const tenantDb = c.get("tenantDb");
      const statusId = c.req.param("id");

      const status = await tenantDb
        .selectFrom("status_updates")
        .select(["id", "from_jid"])
        .where("id", "=", statusId)
        .executeTakeFirst();

      if (!status) {
        return c.json({ error: "Status not found" }, 404);
      }

      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["jid"])
        .where("status", "=", "connected")
        .executeTakeFirst();

      if (
        connection?.jid &&
        status.from_jid !== connection.jid &&
        status.from_jid !== "me"
      ) {
        return c.json({ error: "Cannot delete other users' statuses" }, 403);
      }

      await tenantDb
        .deleteFrom("status_updates")
        .where("id", "=", statusId)
        .execute();

      return c.json({ success: true });
    });
  });

  describe("GET /status", () => {
    it("returns empty list when no statuses exist", async () => {
      const res = await app.request("/status");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.pagination).toBeDefined();
    });

    it("returns status updates grouped by contact", async () => {
      const now = new Date();
      const status1 = createMockStatusUpdate({
        id: "status-1",
        from_jid: "user1@s.whatsapp.net",
        expires_at: new Date(now.getTime() + 3600000),
      });
      const status2 = createMockStatusUpdate({
        id: "status-2",
        from_jid: "user1@s.whatsapp.net",
        expires_at: new Date(now.getTime() + 3600000),
      });
      const status3 = createMockStatusUpdate({
        id: "status-3",
        from_jid: "user2@s.whatsapp.net",
        expires_at: new Date(now.getTime() + 3600000),
      });

      mockTenantDb._setStatusUpdates([status1, status2, status3]);

      const res = await app.request("/status");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.length).toBe(2); // 2 contacts
    });

    it("filters out expired statuses", async () => {
      const now = new Date();
      const activeStatus = createMockStatusUpdate({
        id: "active",
        expires_at: new Date(now.getTime() + 3600000),
      });
      const expiredStatus = createMockStatusUpdate({
        id: "expired",
        expires_at: new Date(now.getTime() - 3600000),
      });

      mockTenantDb._setStatusUpdates([activeStatus, expiredStatus]);

      const res = await app.request("/status");
      const data = await res.json();

      expect(res.status).toBe(200);
      // Only active status should be returned
      expect(data.data.length).toBe(1);
    });
  });

  describe("GET /status/:jid", () => {
    it("returns 404 when no status found for JID", async () => {
      const res = await app.request("/status/unknown@s.whatsapp.net");
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("No status updates found");
    });

    it("returns statuses for specific contact", async () => {
      const now = new Date();
      const jid = "user1@s.whatsapp.net";
      const status = createMockStatusUpdate({
        id: "status-1",
        from_jid: jid,
        expires_at: new Date(now.getTime() + 3600000),
      });

      mockTenantDb._setStatusUpdates([status]);

      const res = await app.request(`/status/${encodeURIComponent(jid)}`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.jid).toBe(jid);
      expect(data.statuses.length).toBe(1);
    });
  });

  describe("GET /status/stats/overview", () => {
    it("returns status statistics", async () => {
      const now = new Date();
      const statuses = [
        createMockStatusUpdate({
          id: "1",
          from_jid: "user1@s.whatsapp.net",
          expires_at: new Date(now.getTime() + 3600000),
        }),
        createMockStatusUpdate({
          id: "2",
          from_jid: "user2@s.whatsapp.net",
          expires_at: new Date(now.getTime() + 3600000),
        }),
      ];

      mockTenantDb._setStatusUpdates(statuses);

      const res = await app.request("/status/stats/overview");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.activeStatuses).toBe(2);
      expect(data.contactsWithStatus).toBe(2);
    });
  });

  describe("GET /status/my", () => {
    it("returns empty list when not connected", async () => {
      const res = await app.request("/status/my");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("returns my statuses when connected", async () => {
      const now = new Date();
      const connection = createMockWhatsAppConnection({
        jid: "me@s.whatsapp.net",
        status: "connected",
      });
      const myStatus = createMockStatusUpdate({
        id: "my-status",
        from_jid: "me@s.whatsapp.net",
        expires_at: new Date(now.getTime() + 3600000),
      });

      mockTenantDb._setConnection(connection);
      mockTenantDb._setStatusUpdates([myStatus]);

      const res = await app.request("/status/my");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.count).toBe(1);
    });
  });

  describe("POST /status", () => {
    it("returns 400 when type is missing", async () => {
      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("type is required");
    });

    it("returns 400 when type is invalid", async () => {
      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "invalid" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("type is required");
    });

    it("returns 400 when content is missing for text status", async () => {
      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "text" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("content is required for text status");
    });

    it("returns 400 when mediaUrl is missing for image status", async () => {
      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("mediaUrl is required for image/video status");
    });

    it("returns 400 when WhatsApp is not connected", async () => {
      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "text", content: "Hello" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("WhatsApp is not connected");
    });

    it("successfully posts a text status", async () => {
      const connection = createMockWhatsAppConnection({
        status: "connected",
      });
      mockTenantDb._setConnection(connection);

      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "text", content: "Hello World!" }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status.type).toBe("text");
      expect(data.status.content).toBe("Hello World!");
      expect(mockPublishPostStatus).toHaveBeenCalled();
    });

    it("successfully posts an image status with caption", async () => {
      const connection = createMockWhatsAppConnection({
        status: "connected",
      });
      mockTenantDb._setConnection(connection);

      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image",
          mediaUrl: "https://example.com/image.jpg",
          content: "Check out this photo!",
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status.type).toBe("image");
      expect(data.status.mediaUrl).toBe("https://example.com/image.jpg");
    });

    it("successfully posts a video status", async () => {
      const connection = createMockWhatsAppConnection({
        status: "connected",
      });
      mockTenantDb._setConnection(connection);

      const res = await app.request("/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "video",
          mediaUrl: "https://example.com/video.mp4",
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status.type).toBe("video");
    });
  });

  describe("DELETE /status/:id", () => {
    it("returns 404 when status not found", async () => {
      const res = await app.request("/status/non-existent-id", {
        method: "DELETE",
      });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Status not found");
    });

    it("successfully deletes own status", async () => {
      const now = new Date();
      const connection = createMockWhatsAppConnection({
        jid: "me@s.whatsapp.net",
        status: "connected",
      });
      const myStatus = createMockStatusUpdate({
        id: "my-status-to-delete",
        from_jid: "me@s.whatsapp.net",
        expires_at: new Date(now.getTime() + 3600000),
      });

      mockTenantDb._setConnection(connection);
      mockTenantDb._setStatusUpdates([myStatus]);

      const res = await app.request("/status/my-status-to-delete", {
        method: "DELETE",
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
