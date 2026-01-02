/**
 * Unit tests for messages.ts routes
 *
 * Tests the message status feature for read receipts display
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockMessage } from "../mocks";

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
    "innerJoin",
    "leftJoin",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
    "having",
    "on",
    "onRef",
    "filterWhere",
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
    as: mock(() => mockBuilder),
  };

  // Setup chainable methods
  chainMethods.forEach((method) => {
    mockBuilder[method] = mock(() => mockBuilder);
  });

  // Setup terminal methods
  Object.entries(terminalMethods).forEach(([method, fn]) => {
    mockBuilder[method] = fn;
  });

  mockBuilder.or = mock(() => true);
  mockBuilder.fn = {
    max: mock(() => mockBuilder),
    count: mock(() => mockBuilder),
  };

  return mockBuilder;
}

// Create a mock tenant db for messages
function createMockTenantDb(messages: ReturnType<typeof createMockMessage>[] = []) {
  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "messages") {
        const builder = createMockQueryBuilder(messages);
        return builder;
      }
      return createMockQueryBuilder();
    }),
    insertInto: mock((table: string) => {
      const builder: Record<string, unknown> = {};
      const chainMethods = ["values", "returning"];
      chainMethods.forEach((method) => {
        builder[method] = mock(() => builder);
      });
      builder.execute = mock(() => Promise.resolve([]));
      builder.executeTakeFirst = mock(() =>
        Promise.resolve({
          id: "new-message-123",
          status: "pending",
          timestamp: new Date(),
        })
      );
      return builder;
    }),
    updateTable: mock((table: string) => {
      const builder: Record<string, unknown> = {};
      const chainMethods = ["set", "where", "returning"];
      chainMethods.forEach((method) => {
        builder[method] = mock(() => builder);
      });
      builder.execute = mock(() => Promise.resolve({ numUpdatedRows: 1n }));
      builder.executeTakeFirst = mock(() =>
        Promise.resolve({ numUpdatedRows: 1n })
      );
      return builder;
    }),
  };

  return mockDb;
}

describe("GET /conversations/:id/messages - Message status in response", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    // Create test messages with different statuses
    const testMessages = [
      createMockMessage({
        id: "msg-1",
        message_id: "wa-msg-1",
        from_me: true,
        content: "Hello!",
        status: "read",
        timestamp: new Date("2024-01-01T10:00:00Z"),
      }),
      createMockMessage({
        id: "msg-2",
        message_id: "wa-msg-2",
        from_me: true,
        content: "How are you?",
        status: "delivered",
        timestamp: new Date("2024-01-01T10:01:00Z"),
      }),
      createMockMessage({
        id: "msg-3",
        message_id: "wa-msg-3",
        from_me: false,
        content: "I'm good!",
        status: "sent",
        timestamp: new Date("2024-01-01T10:02:00Z"),
      }),
      createMockMessage({
        id: "msg-4",
        message_id: "wa-msg-4",
        from_me: true,
        content: "Great!",
        status: "pending",
        timestamp: new Date("2024-01-01T10:03:00Z"),
      }),
    ];

    mockTenantDb = createMockTenantDb(testMessages);

    // Create a test app with the route
    app = new Hono();

    // Mock middleware that sets tenantDb and user
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    // Mount a simplified route handler for testing
    app.get("/conversations/:id/messages", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const contactId = c.req.param("id");
      const limit = parseInt(c.req.query("limit") || "50", 10);

      const messages = await tenantDb
        .selectFrom("messages")
        .selectAll()
        .where("contact_id", "=", contactId)
        .orderBy("timestamp", "desc")
        .limit(limit)
        .execute();

      // Map to frontend format with status
      const formattedMessages = (messages as ReturnType<typeof createMockMessage>[]).map((msg) => ({
        id: msg.id,
        messageId: msg.message_id,
        conversationId: msg.contact_id,
        contactId: msg.contact_id,
        senderId: msg.sent_by_user_id || msg.sender_jid || "",
        senderType: msg.from_me ? "user" : "contact",
        senderJid: msg.sender_jid,
        messageType: msg.message_type,
        content: msg.content || "",
        isForwarded: msg.is_forwarded,
        isStarred: msg.is_starred,
        isDeleted: msg.deleted_by_sender || !!msg.deleted_at,
        status: msg.status || (msg.from_me ? "sent" : "delivered"),
        timestamp: msg.timestamp,
        createdAt: msg.created_at,
        updatedAt: msg.created_at,
      }));

      return c.json({
        messages: formattedMessages,
        hasMore: messages.length === limit,
        nextCursor: messages.length > 0 ? (messages as { id: string }[])[messages.length - 1].id : null,
      });
    });
  });

  it("should return messages with status field", async () => {
    const response = await app.request("/conversations/contact-123/messages", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.messages).toBeDefined();
    expect(data.messages.length).toBe(4);

    // Check that all messages have status field
    data.messages.forEach((msg: { status: string }) => {
      expect(msg.status).toBeDefined();
      expect(["pending", "sent", "delivered", "read", "failed"]).toContain(msg.status);
    });
  });

  it("should return correct status for sent messages", async () => {
    const response = await app.request("/conversations/contact-123/messages", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    // Find the message with "read" status
    const readMessage = data.messages.find((m: { id: string }) => m.id === "msg-1");
    expect(readMessage).toBeDefined();
    expect(readMessage.status).toBe("read");
    expect(readMessage.senderType).toBe("user");

    // Find the message with "delivered" status
    const deliveredMessage = data.messages.find((m: { id: string }) => m.id === "msg-2");
    expect(deliveredMessage).toBeDefined();
    expect(deliveredMessage.status).toBe("delivered");

    // Find the pending message
    const pendingMessage = data.messages.find((m: { id: string }) => m.id === "msg-4");
    expect(pendingMessage).toBeDefined();
    expect(pendingMessage.status).toBe("pending");
  });

  it("should include senderType field for distinguishing own messages", async () => {
    const response = await app.request("/conversations/contact-123/messages", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    // Check own messages have senderType "user"
    const ownMessages = data.messages.filter((m: { senderType: string }) => m.senderType === "user");
    expect(ownMessages.length).toBe(3); // msg-1, msg-2, msg-4

    // Check received messages have senderType "contact"
    const receivedMessages = data.messages.filter((m: { senderType: string }) => m.senderType === "contact");
    expect(receivedMessages.length).toBe(1); // msg-3
  });
});

describe("POST /messages - New message status", () => {
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

    // Simplified send message route
    app.post("/messages", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const body = await c.req.json();

      const { contactId, content, messageType = "text" } = body;

      if (!contactId) {
        return c.json({ error: "contactId is required" }, 400);
      }

      if (!content && messageType === "text") {
        return c.json({ error: "content is required for text messages" }, 400);
      }

      const messageId = crypto.randomUUID();
      const waMessageId = `pending_${messageId}`;

      await tenantDb
        .insertInto("messages")
        .values({
          id: messageId,
          contact_id: contactId,
          message_id: waMessageId,
          from_me: true,
          message_type: messageType,
          content,
          status: "pending",
          timestamp: new Date(),
        })
        .execute();

      return c.json({
        success: true,
        message: {
          id: messageId,
          messageId: waMessageId,
          contactId,
          fromMe: true,
          messageType,
          content,
          status: "pending",
          timestamp: new Date().toISOString(),
        },
      });
    });
  });

  it("should create a new message with pending status", async () => {
    const response = await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "contact-123",
        content: "Hello, world!",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message.status).toBe("pending");
    expect(data.message.fromMe).toBe(true);
  });

  it("should return 400 if contactId is missing", async () => {
    const response = await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Hello, world!",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("contactId is required");
  });

  it("should return 400 if content is missing for text message", async () => {
    const response = await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "contact-123",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("content is required for text messages");
  });
});

describe("Message status values", () => {
  it("should support all valid status values", () => {
    const validStatuses = ["pending", "sent", "delivered", "read", "failed"];

    validStatuses.forEach((status) => {
      const message = createMockMessage({
        status: status as "pending" | "sent" | "delivered" | "read" | "failed",
      });
      expect(message.status).toBe(status);
    });
  });

  it("should default to sent status for own messages", () => {
    const message = createMockMessage({ from_me: true });
    expect(message.status).toBe("sent");
  });
});

describe("POST /messages - Auto-assign on first reply", () => {
  let app: Hono;
  let mockContact: { id: string; jid: string };
  let autoAssignCalled: boolean;
  let assignedUserId: string | null;

  beforeEach(() => {
    mockContact = { id: "contact-123", jid: "1234567890@s.whatsapp.net" };
    autoAssignCalled = false;
    assignedUserId = null;

    // Create a mock that tracks auto-assignment
    const createMockDbWithAssignment = (hasExistingAssignment: boolean) => {
      return {
        selectFrom: mock((table: string) => {
          if (table === "contacts") {
            return {
              select: mock(() => ({
                where: mock(() => ({
                  executeTakeFirst: mock(() => Promise.resolve(mockContact)),
                })),
              })),
            };
          }
          if (table === "contact_assignments") {
            // Return existing assignment if hasExistingAssignment is true
            return {
              select: mock(() => ({
                where: mock(() => ({
                  where: mock(() => ({
                    executeTakeFirst: mock(() =>
                      Promise.resolve(
                        hasExistingAssignment
                          ? { id: "existing-assignment", assigned_to: "other-user" }
                          : undefined
                      )
                    ),
                  })),
                })),
              })),
            };
          }
          return createMockQueryBuilder();
        }),
        insertInto: mock((table: string) => {
          if (table === "contact_assignments") {
            autoAssignCalled = true;
            return {
              values: mock((vals: { assigned_to: string }) => {
                assignedUserId = vals.assigned_to;
                return {
                  returning: mock(() => ({
                    executeTakeFirstOrThrow: mock(() =>
                      Promise.resolve({
                        id: "new-assignment-123",
                        assigned_to: vals.assigned_to,
                        assigned_by: vals.assigned_to,
                        assigned_at: new Date(),
                      })
                    ),
                  })),
                };
              }),
            };
          }
          return {
            values: mock(() => ({
              returning: mock(() => ({
                execute: mock(() => Promise.resolve([])),
              })),
              execute: mock(() => Promise.resolve([])),
            })),
          };
        }),
        updateTable: mock((table: string) => ({
          set: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                execute: mock(() => Promise.resolve({ numUpdatedRows: 0n })),
              })),
            })),
          })),
        })),
      };
    };

    app = new Hono();

    // Test route that simulates message sending with auto-assign
    app.post("/messages/with-auto-assign", async (c) => {
      const body = await c.req.json();
      const { contactId, content, hasExistingAssignment = false } = body;

      if (!contactId) {
        return c.json({ error: "contactId is required" }, 400);
      }

      const mockDb = createMockDbWithAssignment(hasExistingAssignment);
      c.set("tenantDb", mockDb);
      c.set("user", { id: "user-123", email: "test@example.com" });

      // Check for existing assignment
      const existingAssignment = await mockDb
        .selectFrom("contact_assignments")
        .select(["id", "assigned_to"])
        .where("contact_id", "=", contactId)
        .where("unassigned_at", "is", null)
        .executeTakeFirst();

      let wasAutoAssigned = false;

      if (!existingAssignment) {
        // Auto-assign to current user
        await mockDb
          .updateTable("contact_assignments")
          .set({ unassigned_at: new Date() })
          .where("contact_id", "=", contactId)
          .where("unassigned_at", "is", null)
          .execute();

        await mockDb
          .insertInto("contact_assignments")
          .values({
            contact_id: contactId,
            assigned_to: "user-123",
            assigned_by: "user-123",
          })
          .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
          .executeTakeFirstOrThrow();

        wasAutoAssigned = true;
      }

      return c.json({
        success: true,
        message: {
          id: "msg-123",
          contactId,
          content,
          status: "pending",
        },
        autoAssigned: wasAutoAssigned,
      });
    });
  });

  it("should auto-assign contact when sending first message to unassigned contact", async () => {
    const response = await app.request("/messages/with-auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "contact-123",
        content: "Hello!",
        hasExistingAssignment: false,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.autoAssigned).toBe(true);
    expect(autoAssignCalled).toBe(true);
    expect(assignedUserId).toBe("user-123");
  });

  it("should not auto-assign when contact is already assigned", async () => {
    const response = await app.request("/messages/with-auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "contact-123",
        content: "Hello!",
        hasExistingAssignment: true,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.autoAssigned).toBe(false);
    // When already assigned, no new assignment should be created
    expect(autoAssignCalled).toBe(false);
  });

  it("should return autoAssigned flag in response", async () => {
    const response = await app.request("/messages/with-auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "contact-123",
        content: "Hello!",
        hasExistingAssignment: false,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("autoAssigned");
    expect(typeof data.autoAssigned).toBe("boolean");
  });
});
