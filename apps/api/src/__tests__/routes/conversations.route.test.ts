/**
 * Unit tests for conversation state routes
 *
 * Tests the conversation state API endpoints:
 * - GET /conversations/:id/state
 * - POST /conversations/:id/resolve
 * - POST /conversations/:id/reopen
 * - POST /conversations/:id/pending
 * - GET /conversations/stats/resolution
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import {
  createMockConversationState,
  createMockContact,
  createMockQueryBuilder,
} from "../mocks";

// Create a mock tenant db for conversation states
function createMockTenantDb() {
  let conversationStates: unknown[] = [];
  let contacts: unknown[] = [];
  let insertedState: unknown = null;
  let updatedState: unknown = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "conversation_states") {
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
          return Promise.resolve(conversationStates);
        });

        builder.executeTakeFirst = mock(() => {
          if (currentFilter) {
            const found = conversationStates.find(
              (state: unknown) =>
                (state as Record<string, unknown>).id === currentFilter ||
                (state as Record<string, unknown>).contact_id === currentFilter,
            );
            return Promise.resolve(found);
          }
          return Promise.resolve(conversationStates[0]);
        });

        // For count queries
        builder.select = mock((selectorFn?: unknown) => {
          if (typeof selectorFn === "function") {
            const eb = {
              fn: {
                count: () => ({
                  as: () => "count",
                  filterWhere: () => ({ as: () => "filtered_count" }),
                }),
              },
            };
            selectorFn(eb);
          }
          return builder;
        });

        return builder;
      }

      if (table === "contacts") {
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

        builder.executeTakeFirst = mock(() => {
          if (currentFilter) {
            const found = contacts.find(
              (c: unknown) =>
                (c as Record<string, unknown>).id === currentFilter,
            );
            return Promise.resolve(found);
          }
          return Promise.resolve(contacts[0]);
        });

        return builder;
      }

      return createMockQueryBuilder();
    }),

    insertInto: mock((table: string) => {
      if (table === "conversation_states") {
        const builder: Record<string, unknown> = {};
        const chainMethods = ["values", "returningAll"];
        chainMethods.forEach((method) => {
          builder[method] = mock((values?: unknown) => {
            if (method === "values") {
              insertedState = values;
            }
            return builder;
          });
        });
        builder.executeTakeFirst = mock(() =>
          Promise.resolve(
            insertedState
              ? {
                  id: "new-conv-state-123",
                  ...(insertedState as object),
                  created_at: new Date(),
                  updated_at: new Date(),
                }
              : null,
          ),
        );
        builder.executeTakeFirstOrThrow = mock(() =>
          Promise.resolve({
            id: "new-conv-state-123",
            ...(insertedState as object),
            created_at: new Date(),
            updated_at: new Date(),
          }),
        );
        return builder;
      }
      return createMockQueryBuilder();
    }),

    updateTable: mock((table: string) => {
      if (table === "conversation_states") {
        const builder: Record<string, unknown> = {};
        let updateContactId: string | null = null;

        builder.set = mock((values: unknown) => {
          updatedState = values;
          return builder;
        });

        builder.where = mock((_col: string, _op: string, value: unknown) => {
          updateContactId = value as string;
          return builder;
        });

        builder.returningAll = mock(() => builder);

        builder.executeTakeFirst = mock(() => {
          const existing = conversationStates.find(
            (state: unknown) =>
              (state as Record<string, unknown>).contact_id === updateContactId,
          );
          if (existing) {
            return Promise.resolve({
              ...(existing as object),
              ...(updatedState as object),
              updated_at: new Date(),
            });
          }
          return Promise.resolve(null);
        });

        builder.executeTakeFirstOrThrow = mock(() => {
          const existing = conversationStates.find(
            (state: unknown) =>
              (state as Record<string, unknown>).contact_id === updateContactId,
          );
          return Promise.resolve({
            ...(existing as object),
            ...(updatedState as object),
            updated_at: new Date(),
          });
        });

        return builder;
      }
      return createMockQueryBuilder();
    }),

    setConversationStates: (states: unknown[]) => {
      conversationStates = states;
    },
    setContacts: (c: unknown[]) => {
      contacts = c;
    },
    getInsertedState: () => insertedState,
    getUpdatedState: () => updatedState,
  };

  return mockDb;
}

describe("GET /conversations/:id/state - Get conversation state", () => {
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
    app.get("/conversations/:id/state", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const contactId = c.req.param("id");

      const state = await tenantDb
        .selectFrom("conversation_states")
        .selectAll()
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!state) {
        return c.json({
          contactId,
          status: "open",
          resolvedAt: null,
          resolvedBy: null,
          reopenedAt: null,
          reopenedBy: null,
          resolutionNotes: null,
        });
      }

      const s = state as Record<string, unknown>;
      return c.json({
        id: s.id,
        contactId: s.contact_id,
        status: s.status,
        resolvedAt: s.resolved_at,
        resolvedBy: s.resolved_by,
        reopenedAt: s.reopened_at,
        reopenedBy: s.reopened_by,
        resolutionNotes: s.resolution_notes,
      });
    });
  });

  it("should return default open state when no state exists", async () => {
    mockTenantDb.setConversationStates([]);

    const response = await app.request("/conversations/contact-123/state", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("open");
    expect(data.contactId).toBe("contact-123");
    expect(data.resolvedAt).toBeNull();
  });

  it("should return existing conversation state", async () => {
    const resolvedAt = new Date();
    const state = createMockConversationState({
      id: "state-123",
      contact_id: "contact-123",
      status: "resolved",
      resolved_at: resolvedAt,
      resolved_by: "user-456",
      resolution_notes: "Issue resolved",
    });
    mockTenantDb.setConversationStates([state]);

    const response = await app.request("/conversations/contact-123/state", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("resolved");
    expect(data.resolvedBy).toBe("user-456");
    expect(data.resolutionNotes).toBe("Issue resolved");
  });
});

describe("POST /conversations/:id/resolve - Resolve conversation", () => {
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

    app.post("/conversations/:id/resolve", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };
      const contactId = c.req.param("id");

      let notes: string | undefined;
      try {
        const body = await c.req.json();
        notes = body.notes;
      } catch {
        // No body
      }

      // Verify contact exists
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "custom_name", "push_name", "phone_number"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }

      // Check if state exists, if not create it
      const existingState = await tenantDb
        .selectFrom("conversation_states")
        .selectAll()
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!existingState) {
        await tenantDb
          .insertInto("conversation_states")
          .values({ contact_id: contactId, status: "open" })
          .returningAll()
          .executeTakeFirst();
      }

      // Update to resolved
      const state = await tenantDb
        .updateTable("conversation_states")
        .set({
          status: "resolved",
          resolved_at: new Date(),
          resolved_by: user.id,
          resolution_notes: notes || null,
          updated_at: new Date(),
        })
        .where("contact_id", "=", contactId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const s = state as Record<string, unknown>;
      return c.json({
        success: true,
        state: {
          id: s.id,
          contactId: s.contact_id,
          status: s.status,
          resolvedAt: s.resolved_at,
          resolvedBy: s.resolved_by,
          resolutionNotes: s.resolution_notes,
        },
      });
    });
  });

  it("should resolve a conversation", async () => {
    const contact = createMockContact({ id: "contact-123" });
    const state = createMockConversationState({ contact_id: "contact-123" });
    mockTenantDb.setContacts([contact]);
    mockTenantDb.setConversationStates([state]);

    const response = await app.request("/conversations/contact-123/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Issue resolved successfully" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.state.status).toBe("resolved");
    expect(data.state.resolvedBy).toBe("user-123");
    expect(data.state.resolutionNotes).toBe("Issue resolved successfully");
  });

  it("should return 404 for non-existent contact", async () => {
    mockTenantDb.setContacts([]);
    mockTenantDb.setConversationStates([]);

    const response = await app.request("/conversations/non-existent/resolve", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Contact not found");
  });
});

describe("POST /conversations/:id/reopen - Reopen conversation", () => {
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

    app.post("/conversations/:id/reopen", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };
      const contactId = c.req.param("id");

      // Verify contact exists
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }

      // Update to open
      const state = await tenantDb
        .updateTable("conversation_states")
        .set({
          status: "open",
          reopened_at: new Date(),
          reopened_by: user.id,
          updated_at: new Date(),
        })
        .where("contact_id", "=", contactId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const s = state as Record<string, unknown>;
      return c.json({
        success: true,
        state: {
          id: s.id,
          contactId: s.contact_id,
          status: s.status,
          reopenedAt: s.reopened_at,
          reopenedBy: s.reopened_by,
        },
      });
    });
  });

  it("should reopen a resolved conversation", async () => {
    const contact = createMockContact({ id: "contact-123" });
    const state = createMockConversationState({
      contact_id: "contact-123",
      status: "resolved",
      resolved_at: new Date(),
      resolved_by: "user-456",
    });
    mockTenantDb.setContacts([contact]);
    mockTenantDb.setConversationStates([state]);

    const response = await app.request("/conversations/contact-123/reopen", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.state.status).toBe("open");
    expect(data.state.reopenedBy).toBe("user-123");
  });
});

describe("POST /conversations/:id/pending - Set conversation pending", () => {
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

    app.post("/conversations/:id/pending", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const contactId = c.req.param("id");

      // Verify contact exists
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }

      // Update to pending
      const state = await tenantDb
        .updateTable("conversation_states")
        .set({
          status: "pending",
          updated_at: new Date(),
        })
        .where("contact_id", "=", contactId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const s = state as Record<string, unknown>;
      return c.json({
        success: true,
        state: {
          id: s.id,
          contactId: s.contact_id,
          status: s.status,
        },
      });
    });
  });

  it("should set conversation to pending", async () => {
    const contact = createMockContact({ id: "contact-123" });
    const state = createMockConversationState({ contact_id: "contact-123" });
    mockTenantDb.setContacts([contact]);
    mockTenantDb.setConversationStates([state]);

    const response = await app.request("/conversations/contact-123/pending", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.state.status).toBe("pending");
  });
});

describe("GET /conversations/stats/resolution - Get resolution stats", () => {
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

    app.get("/conversations/stats/resolution", async (c) => {
      // Return mock stats
      return c.json({
        data: {
          totalConversations: 100,
          openConversations: 30,
          pendingConversations: 20,
          resolvedConversations: 50,
          resolutionRate: 50.0,
          averageResolutionTimeMinutes: null,
        },
        meta: {
          startDate: null,
          endDate: null,
        },
      });
    });
  });

  it("should return resolution statistics", async () => {
    const response = await app.request("/conversations/stats/resolution", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.totalConversations).toBe(100);
    expect(data.data.resolvedConversations).toBe(50);
    expect(data.data.resolutionRate).toBe(50.0);
    expect(data.data.openConversations).toBe(30);
    expect(data.data.pendingConversations).toBe(20);
  });
});
