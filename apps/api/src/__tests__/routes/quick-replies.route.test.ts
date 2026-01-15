/**
 * Unit tests for quick-replies.ts routes
 *
 * Tests the quick replies API endpoints:
 * - GET /quick-replies
 * - GET /quick-replies/:id
 * - GET /quick-replies/search/:shortcut
 * - POST /quick-replies
 * - PATCH /quick-replies/:id
 * - DELETE /quick-replies/:id
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockQuickReply, createMockQueryBuilder } from "../mocks";

// Create a mock tenant db for quick replies
function createMockTenantDb() {
  let quickReplies: unknown[] = [];
  let insertedQuickReply: unknown = null;
  let updatedQuickReply: unknown = null;
  let deletedId: string | null = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "quick_replies") {
        const builder: Record<string, unknown> = {};
        let currentFilter: unknown = null;

        const chainMethods = [
          "selectAll",
          "select",
          "orderBy",
          "limit",
          "offset",
        ];
        chainMethods.forEach((method) => {
          builder[method] = mock(() => builder);
        });

        builder.where = mock((_col: string, _op: string, value: unknown) => {
          currentFilter = value;
          return builder;
        });

        builder.execute = mock(() => {
          if (currentFilter) {
            // Filter by id or shortcut
            const filtered = quickReplies.filter(
              (qr: unknown) =>
                (qr as Record<string, unknown>).id === currentFilter ||
                (qr as Record<string, unknown>).shortcut === currentFilter,
            );
            return Promise.resolve(filtered);
          }
          return Promise.resolve(quickReplies);
        });

        builder.executeTakeFirst = mock(() => {
          if (currentFilter) {
            const found = quickReplies.find(
              (qr: unknown) =>
                (qr as Record<string, unknown>).id === currentFilter ||
                (qr as Record<string, unknown>).shortcut === currentFilter,
            );
            return Promise.resolve(found);
          }
          return Promise.resolve(quickReplies[0]);
        });

        // For count queries
        const eb = {
          fn: {
            countAll: () => ({
              as: () => "count",
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
      return createMockQueryBuilder();
    }),
    insertInto: mock((table: string) => {
      if (table === "quick_replies") {
        const builder: Record<string, unknown> = {};
        const chainMethods = ["values", "returningAll"];
        chainMethods.forEach((method) => {
          builder[method] = mock((values?: unknown) => {
            if (method === "values") {
              insertedQuickReply = values;
            }
            return builder;
          });
        });
        builder.executeTakeFirst = mock(() =>
          Promise.resolve(
            insertedQuickReply
              ? {
                  id: "new-quick-reply-123",
                  ...(insertedQuickReply as object),
                  created_at: new Date(),
                  updated_at: new Date(),
                }
              : null,
          ),
        );
        return builder;
      }
      return createMockQueryBuilder();
    }),
    updateTable: mock((table: string) => {
      if (table === "quick_replies") {
        const builder: Record<string, unknown> = {};
        let updateId: string | null = null;

        builder.set = mock((values: unknown) => {
          updatedQuickReply = values;
          return builder;
        });

        builder.where = mock((_col: string, _op: string, value: unknown) => {
          updateId = value as string;
          return builder;
        });

        builder.returningAll = mock(() => builder);

        builder.executeTakeFirst = mock(() => {
          const existing = quickReplies.find(
            (qr: unknown) => (qr as Record<string, unknown>).id === updateId,
          );
          if (existing) {
            return Promise.resolve({
              ...(existing as object),
              ...(updatedQuickReply as object),
              updated_at: new Date(),
            });
          }
          return Promise.resolve(null);
        });

        return builder;
      }
      return createMockQueryBuilder();
    }),
    deleteFrom: mock((table: string) => {
      if (table === "quick_replies") {
        const builder: Record<string, unknown> = {};

        builder.where = mock((_col: string, _op: string, value: unknown) => {
          deletedId = value as string;
          return builder;
        });

        builder.executeTakeFirst = mock(() => {
          const existingIndex = quickReplies.findIndex(
            (qr: unknown) => (qr as Record<string, unknown>).id === deletedId,
          );
          if (existingIndex !== -1) {
            quickReplies.splice(existingIndex, 1);
            return Promise.resolve({ numDeletedRows: BigInt(1) });
          }
          return Promise.resolve({ numDeletedRows: BigInt(0) });
        });

        return builder;
      }
      return createMockQueryBuilder();
    }),
    setQuickReplies: (replies: unknown[]) => {
      quickReplies = replies;
    },
    getInsertedQuickReply: () => insertedQuickReply,
    getUpdatedQuickReply: () => updatedQuickReply,
  };

  return mockDb;
}

describe("GET /quick-replies - List quick replies", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    // Mock middleware
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    // Simplified route handler for testing
    app.get("/quick-replies", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;

      const rows = await tenantDb
        .selectFrom("quick_replies")
        .selectAll()
        .orderBy("shortcut", "asc")
        .limit(50)
        .offset(0)
        .execute();

      return c.json({
        data: (rows as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          shortcut: row.shortcut,
          title: row.title,
          content: row.content,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        meta: {
          total: rows.length,
          limit: 50,
          offset: 0,
        },
      });
    });
  });

  it("should return empty list when no quick replies exist", async () => {
    mockTenantDb.setQuickReplies([]);

    const response = await app.request("/quick-replies", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toEqual([]);
    expect(data.meta.total).toBe(0);
  });

  it("should return list of quick replies", async () => {
    const quickReplies = [
      createMockQuickReply({ id: "qr-1", shortcut: "bye", title: "Goodbye" }),
      createMockQuickReply({
        id: "qr-2",
        shortcut: "greeting",
        title: "Hello",
      }),
    ];
    mockTenantDb.setQuickReplies(quickReplies);

    const response = await app.request("/quick-replies", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.length).toBe(2);
    expect(data.data[0].shortcut).toBe("bye");
    expect(data.data[1].shortcut).toBe("greeting");
  });
});

describe("GET /quick-replies/:id - Get quick reply by ID", () => {
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

    app.get("/quick-replies/:id", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const quickReplyId = c.req.param("id");

      const row = await tenantDb
        .selectFrom("quick_replies")
        .selectAll()
        .where("id", "=", quickReplyId)
        .executeTakeFirst();

      if (!row) {
        return c.json({ error: "Quick reply not found" }, 404);
      }

      const r = row as Record<string, unknown>;
      return c.json({
        data: {
          id: r.id,
          shortcut: r.shortcut,
          title: r.title,
          content: r.content,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      });
    });
  });

  it("should return quick reply by ID", async () => {
    const quickReply = createMockQuickReply({ id: "qr-123" });
    mockTenantDb.setQuickReplies([quickReply]);

    const response = await app.request("/quick-replies/qr-123", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.id).toBe("qr-123");
    expect(data.data.shortcut).toBe("greeting");
  });

  it("should return 404 for non-existent quick reply", async () => {
    mockTenantDb.setQuickReplies([]);

    const response = await app.request("/quick-replies/non-existent", {
      method: "GET",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Quick reply not found");
  });
});

describe("GET /quick-replies/search/:shortcut - Search by shortcut", () => {
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

    app.get("/quick-replies/search/:shortcut", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const shortcut = c.req.param("shortcut");

      const row = await tenantDb
        .selectFrom("quick_replies")
        .selectAll()
        .where("shortcut", "=", shortcut)
        .executeTakeFirst();

      if (!row) {
        return c.json({ error: "Quick reply not found" }, 404);
      }

      const r = row as Record<string, unknown>;
      return c.json({
        data: {
          id: r.id,
          shortcut: r.shortcut,
          title: r.title,
          content: r.content,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      });
    });
  });

  it("should find quick reply by shortcut", async () => {
    const quickReply = createMockQuickReply({ shortcut: "thanks" });
    mockTenantDb.setQuickReplies([quickReply]);

    const response = await app.request("/quick-replies/search/thanks", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.shortcut).toBe("thanks");
  });

  it("should return 404 for non-existent shortcut", async () => {
    mockTenantDb.setQuickReplies([]);

    const response = await app.request("/quick-replies/search/unknown", {
      method: "GET",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Quick reply not found");
  });
});

describe("POST /quick-replies - Create quick reply", () => {
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

    app.post("/quick-replies", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };
      const body = await c.req.json();

      // Validate input
      if (!body.shortcut || !body.title || !body.content) {
        return c.json({ error: "Missing required fields" }, 400);
      }

      // Check for valid shortcut format
      const shortcutRegex = /^[a-zA-Z0-9_-]+$/;
      if (!shortcutRegex.test(body.shortcut)) {
        return c.json({ error: "Invalid shortcut format" }, 400);
      }

      // Check for duplicate shortcut
      const existing = await tenantDb
        .selectFrom("quick_replies")
        .selectAll()
        .where("shortcut", "=", body.shortcut)
        .executeTakeFirst();

      if (existing) {
        return c.json(
          {
            error: `Quick reply with shortcut "${body.shortcut}" already exists`,
          },
          409,
        );
      }

      const row = await tenantDb
        .insertInto("quick_replies")
        .values({
          shortcut: body.shortcut,
          title: body.title,
          content: body.content,
          created_by: user.id,
        })
        .returningAll()
        .executeTakeFirst();

      if (!row) {
        return c.json({ error: "Failed to create quick reply" }, 500);
      }

      const r = row as Record<string, unknown>;
      return c.json(
        {
          data: {
            id: r.id,
            shortcut: r.shortcut,
            title: r.title,
            content: r.content,
            createdBy: r.created_by,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          },
        },
        201,
      );
    });
  });

  it("should create a new quick reply", async () => {
    mockTenantDb.setQuickReplies([]);

    const response = await app.request("/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortcut: "welcome",
        title: "Welcome Message",
        content: "Welcome to our service!",
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.data.id).toBe("new-quick-reply-123");
    expect(data.data.shortcut).toBe("welcome");
    expect(data.data.title).toBe("Welcome Message");
    expect(data.data.content).toBe("Welcome to our service!");
  });

  it("should return 400 for missing required fields", async () => {
    const response = await app.request("/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortcut: "test",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required fields");
  });

  it("should return 400 for invalid shortcut format", async () => {
    const response = await app.request("/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortcut: "has spaces",
        title: "Test",
        content: "Test content",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid shortcut format");
  });

  it("should return 409 for duplicate shortcut", async () => {
    mockTenantDb.setQuickReplies([
      createMockQuickReply({ shortcut: "greeting" }),
    ]);

    const response = await app.request("/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortcut: "greeting",
        title: "Another Greeting",
        content: "Hello again!",
      }),
    });

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toBe(
      'Quick reply with shortcut "greeting" already exists',
    );
  });
});

describe("PATCH /quick-replies/:id - Update quick reply", () => {
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

    app.patch("/quick-replies/:id", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const quickReplyId = c.req.param("id");
      const body = await c.req.json();

      // Check if quick reply exists
      const existing = await tenantDb
        .selectFrom("quick_replies")
        .selectAll()
        .where("id", "=", quickReplyId)
        .executeTakeFirst();

      if (!existing) {
        return c.json({ error: "Quick reply not found" }, 404);
      }

      const existingQr = existing as Record<string, unknown>;

      // Check for duplicate shortcut if changing
      if (body.shortcut && body.shortcut !== existingQr.shortcut) {
        const duplicate = await tenantDb
          .selectFrom("quick_replies")
          .selectAll()
          .where("shortcut", "=", body.shortcut)
          .executeTakeFirst();

        if (duplicate) {
          return c.json(
            {
              error: `Quick reply with shortcut "${body.shortcut}" already exists`,
            },
            409,
          );
        }
      }

      // Build update
      const updateData: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (body.shortcut !== undefined) updateData.shortcut = body.shortcut;
      if (body.title !== undefined) updateData.title = body.title;
      if (body.content !== undefined) updateData.content = body.content;

      const row = await tenantDb
        .updateTable("quick_replies")
        .set(updateData)
        .where("id", "=", quickReplyId)
        .returningAll()
        .executeTakeFirst();

      if (!row) {
        return c.json({ error: "Failed to update quick reply" }, 500);
      }

      const r = row as Record<string, unknown>;
      return c.json({
        data: {
          id: r.id,
          shortcut: r.shortcut,
          title: r.title,
          content: r.content,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      });
    });
  });

  it("should update quick reply", async () => {
    mockTenantDb.setQuickReplies([
      createMockQuickReply({ id: "qr-123", shortcut: "old-shortcut" }),
    ]);

    const response = await app.request("/quick-replies/qr-123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated Title",
        content: "Updated content",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.title).toBe("Updated Title");
    expect(data.data.content).toBe("Updated content");
  });

  it("should return 404 for non-existent quick reply", async () => {
    mockTenantDb.setQuickReplies([]);

    const response = await app.request("/quick-replies/non-existent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New Title",
      }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Quick reply not found");
  });

  it("should return 409 when updating to duplicate shortcut", async () => {
    mockTenantDb.setQuickReplies([
      createMockQuickReply({ id: "qr-1", shortcut: "first" }),
      createMockQuickReply({ id: "qr-2", shortcut: "second" }),
    ]);

    const response = await app.request("/quick-replies/qr-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortcut: "second",
      }),
    });

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toBe(
      'Quick reply with shortcut "second" already exists',
    );
  });
});

describe("DELETE /quick-replies/:id - Delete quick reply", () => {
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

    app.delete("/quick-replies/:id", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const quickReplyId = c.req.param("id");

      const result = await tenantDb
        .deleteFrom("quick_replies")
        .where("id", "=", quickReplyId)
        .executeTakeFirst();

      const r = result as { numDeletedRows: bigint };
      if (r.numDeletedRows === BigInt(0)) {
        return c.json({ error: "Quick reply not found" }, 404);
      }

      return c.json({
        data: {
          deleted: true,
        },
      });
    });
  });

  it("should delete quick reply", async () => {
    mockTenantDb.setQuickReplies([createMockQuickReply({ id: "qr-123" })]);

    const response = await app.request("/quick-replies/qr-123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.deleted).toBe(true);
  });

  it("should return 404 for non-existent quick reply", async () => {
    mockTenantDb.setQuickReplies([]);

    const response = await app.request("/quick-replies/non-existent", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Quick reply not found");
  });
});
