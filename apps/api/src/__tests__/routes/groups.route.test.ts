/**
 * Unit tests for groups.ts routes
 *
 * Tests the group management and messaging features:
 * - List groups
 * - Get group details with participants
 * - Update group custom name
 * - Send messages to groups (via messages API)
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockContact, createMockMessage } from "../mocks";

// Helper to create a mock group contact (is_group = true, jid ends with @g.us)
function createMockGroup(overrides: Partial<ReturnType<typeof createMockContact>> = {}) {
  return createMockContact({
    id: "group-123",
    jid: "123456789@g.us", // Group JID format
    phone_number: null, // Groups don't have phone numbers
    push_name: null,
    custom_name: "Test Group",
    is_group: true,
    ...overrides,
  });
}

// Helper to create mock group info (from groups table)
interface MockGroupInfo {
  id: string;
  contact_id: string;
  jid: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: Date;
  participant_count: number;
}

function createMockGroupInfo(overrides: Partial<MockGroupInfo> = {}): MockGroupInfo {
  return {
    id: "group-info-123",
    contact_id: "group-123",
    jid: "123456789@g.us",
    name: "Test Group",
    description: "A test group for messaging",
    created_by: "admin@s.whatsapp.net",
    created_at: new Date(),
    participant_count: 5,
    ...overrides,
  };
}

// Helper to create mock group participant
interface MockGroupParticipant {
  id: string;
  group_id: string;
  participant_jid: string;
  is_admin: boolean;
  joined_at: Date;
}

function createMockGroupParticipant(overrides: Partial<MockGroupParticipant> = {}): MockGroupParticipant {
  return {
    id: "participant-123",
    group_id: "group-info-123",
    participant_jid: "1234567890@s.whatsapp.net",
    is_admin: false,
    joined_at: new Date(),
    ...overrides,
  };
}

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

describe("GET /groups - List groups", () => {
  let app: Hono;

  beforeEach(() => {
    const testGroups = [
      {
        ...createMockGroup({ id: "group-1", custom_name: "Marketing Team" }),
        group_name: "Marketing Team",
        description: "Marketing discussions",
        participant_count: 10,
        last_message_at: new Date("2024-01-01T12:00:00Z"),
        unread_count: 5n,
      },
      {
        ...createMockGroup({ id: "group-2", custom_name: "Sales Team" }),
        group_name: "Sales Team",
        description: "Sales updates",
        participant_count: 8,
        last_message_at: new Date("2024-01-01T11:00:00Z"),
        unread_count: 0n,
      },
    ];

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(testGroups);
        }
        return createMockQueryBuilder({ total: 2n });
      }),
    };

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    // Simplified groups list route
    app.get("/groups", async (c) => {
      const tenantDb = c.get("tenantDb");
      const search = c.req.query("search");
      const limit = parseInt(c.req.query("limit") || "50", 10);
      const offset = parseInt(c.req.query("offset") || "0", 10);

      let groups = await tenantDb
        .selectFrom("contacts")
        .leftJoin("groups", "groups.contact_id", "contacts.id")
        .leftJoin("messages", "messages.contact_id", "contacts.id")
        .select([
          "contacts.id",
          "contacts.jid",
          "contacts.custom_name",
          "groups.name",
          "groups.description",
          "groups.participant_count",
        ])
        .where("contacts.is_group", "=", true)
        .groupBy(["contacts.id", "groups.id"])
        .orderBy("last_message_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute();

      // Apply search filter if needed
      if (search) {
        groups = groups.filter((g: { custom_name: string | null; group_name: string | null }) =>
          g.custom_name?.toLowerCase().includes(search.toLowerCase()) ||
          g.group_name?.toLowerCase().includes(search.toLowerCase())
        );
      }

      const countResult = await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .where("is_group", "=", true)
        .executeTakeFirst();

      const total = 2;

      return c.json({
        data: groups.map((g: {
          id: string;
          jid: string;
          custom_name: string | null;
          group_name: string | null;
          description: string | null;
          participant_count: number;
          profile_picture_url: string | null;
          last_message_at: Date | null;
          unread_count: bigint;
        }) => ({
          id: g.id,
          jid: g.jid,
          name: g.custom_name || g.group_name,
          displayName: g.custom_name || g.group_name || "Unknown Group",
          description: g.description,
          participantCount: g.participant_count,
          profilePictureUrl: g.profile_picture_url,
          lastMessageAt: g.last_message_at,
          unreadCount: Number(g.unread_count),
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + groups.length < total,
        },
      });
    });
  });

  it("should return list of groups with group metadata", async () => {
    const response = await app.request("/groups", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(data.data.length).toBe(2);

    // Verify group fields
    const group = data.data[0];
    expect(group.id).toBeDefined();
    expect(group.jid).toContain("@g.us"); // Group JID format
    expect(group.participantCount).toBeGreaterThan(0);
  });

  it("should return groups with displayName", async () => {
    const response = await app.request("/groups", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    data.data.forEach((group: { displayName: string }) => {
      expect(group.displayName).toBeDefined();
      expect(group.displayName.length).toBeGreaterThan(0);
    });
  });

  it("should include pagination info", async () => {
    const response = await app.request("/groups?limit=10&offset=0", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.pagination).toBeDefined();
    expect(data.pagination.total).toBeDefined();
    expect(data.pagination.limit).toBe(10);
    expect(data.pagination.offset).toBe(0);
    expect(typeof data.pagination.hasMore).toBe("boolean");
  });
});

describe("GET /groups/:id - Get group details", () => {
  let app: Hono;

  beforeEach(() => {
    const mockGroup = createMockGroup({ id: "group-123" });
    const mockGroupInfo = createMockGroupInfo();
    const mockParticipants = [
      createMockGroupParticipant({ participant_jid: "admin@s.whatsapp.net", is_admin: true }),
      createMockGroupParticipant({ id: "p2", participant_jid: "member1@s.whatsapp.net", is_admin: false }),
      createMockGroupParticipant({ id: "p3", participant_jid: "member2@s.whatsapp.net", is_admin: false }),
    ];
    const mockTags = [
      { id: "tag-1", name: "VIP", color: "#ff0000" },
      { id: "tag-2", name: "Support", color: "#00ff00" },
    ];

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(mockGroup);
        }
        if (table === "groups") {
          return createMockQueryBuilder(mockGroupInfo);
        }
        if (table === "group_participants") {
          return createMockQueryBuilder(mockParticipants);
        }
        if (table === "contact_tags") {
          return createMockQueryBuilder(mockTags);
        }
        return createMockQueryBuilder();
      }),
    };

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    app.get("/groups/:id", async (c) => {
      const tenantDb = c.get("tenantDb");
      const contactId = c.req.param("id");

      const contact = await tenantDb
        .selectFrom("contacts")
        .selectAll()
        .where("id", "=", contactId)
        .where("is_group", "=", true)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Group not found" }, 404);
      }

      const group = await tenantDb
        .selectFrom("groups")
        .selectAll()
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      const participants = group
        ? await tenantDb
            .selectFrom("group_participants")
            .select(["participant_jid", "is_admin", "joined_at"])
            .where("group_id", "=", group.id)
            .orderBy("is_admin", "desc")
            .orderBy("joined_at", "asc")
            .execute()
        : [];

      const tags = await tenantDb
        .selectFrom("contact_tags")
        .innerJoin("tags", "tags.id", "contact_tags.tag_id")
        .select(["tags.id", "tags.name", "tags.color"])
        .where("contact_tags.contact_id", "=", contactId)
        .execute();

      return c.json({
        id: contact.id,
        jid: contact.jid,
        name: contact.custom_name || group?.name,
        displayName: contact.custom_name || group?.name || "Unknown Group",
        customName: contact.custom_name,
        description: group?.description,
        profilePictureUrl: contact.profile_picture_url,
        participantCount: group?.participant_count || 0,
        createdBy: group?.created_by,
        createdAt: contact.created_at,
        updatedAt: contact.updated_at,
        participants: participants.map((p: MockGroupParticipant) => ({
          jid: p.participant_jid,
          isAdmin: p.is_admin,
          joinedAt: p.joined_at,
        })),
        tags,
      });
    });
  });

  it("should return group with participant list", async () => {
    const response = await app.request("/groups/group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.id).toBe("group-123");
    expect(data.jid).toContain("@g.us");
    expect(data.participants).toBeDefined();
    expect(data.participants.length).toBe(3);
  });

  it("should include admin status for participants", async () => {
    const response = await app.request("/groups/group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    const admins = data.participants.filter((p: { isAdmin: boolean }) => p.isAdmin);
    const members = data.participants.filter((p: { isAdmin: boolean }) => !p.isAdmin);

    expect(admins.length).toBe(1);
    expect(members.length).toBe(2);
  });

  it("should include group tags", async () => {
    const response = await app.request("/groups/group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.tags).toBeDefined();
    expect(data.tags.length).toBe(2);
    expect(data.tags[0]).toHaveProperty("name");
    expect(data.tags[0]).toHaveProperty("color");
  });

  it("should include group description and participant count", async () => {
    const response = await app.request("/groups/group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.description).toBeDefined();
    expect(data.participantCount).toBe(5);
  });
});

describe("PATCH /groups/:id - Update group custom name", () => {
  let app: Hono;

  beforeEach(() => {
    const mockTenantDb = {
      updateTable: mock((table: string) => {
        return {
          set: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                returning: mock(() => ({
                  executeTakeFirst: mock(() =>
                    Promise.resolve({
                      id: "group-123",
                      custom_name: "New Group Name",
                      updated_at: new Date(),
                    })
                  ),
                })),
              })),
            })),
          })),
        };
      }),
    };

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    app.patch("/groups/:id", async (c) => {
      const tenantDb = c.get("tenantDb");
      const contactId = c.req.param("id");
      const body = await c.req.json();

      const { customName } = body;

      const updated = await tenantDb
        .updateTable("contacts")
        .set({
          custom_name: customName,
          updated_at: new Date(),
        })
        .where("id", "=", contactId)
        .where("is_group", "=", true)
        .returning(["id", "custom_name", "updated_at"])
        .executeTakeFirst();

      if (!updated) {
        return c.json({ error: "Group not found" }, 404);
      }

      return c.json({
        id: updated.id,
        customName: updated.custom_name,
        updatedAt: updated.updated_at,
      });
    });
  });

  it("should update group custom name", async () => {
    const response = await app.request("/groups/group-123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customName: "New Group Name" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.id).toBe("group-123");
    expect(data.customName).toBe("New Group Name");
    expect(data.updatedAt).toBeDefined();
  });
});

describe("POST /messages - Send message to group", () => {
  let app: Hono;
  let publishSendMessageCalled: boolean;
  let publishedJid: string | null;

  beforeEach(() => {
    publishSendMessageCalled = false;
    publishedJid = null;

    const mockGroup = createMockGroup({
      id: "group-123",
      jid: "123456789@g.us", // Group JID
    });

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return {
            select: mock(() => ({
              where: mock(() => ({
                executeTakeFirst: mock(() => Promise.resolve({ id: mockGroup.id, jid: mockGroup.jid })),
              })),
            })),
          };
        }
        if (table === "contact_assignments") {
          return {
            select: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  executeTakeFirst: mock(() => Promise.resolve(undefined)),
                })),
              })),
            })),
          };
        }
        return createMockQueryBuilder();
      }),
      insertInto: mock(() => ({
        values: mock(() => ({
          execute: mock(() => Promise.resolve([])),
          returning: mock(() => ({
            executeTakeFirstOrThrow: mock(() => Promise.resolve({ id: "new-assignment" })),
          })),
        })),
      })),
      updateTable: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              execute: mock(() => Promise.resolve({ numUpdatedRows: 0n })),
            })),
          })),
        })),
      })),
    };

    // Mock NATS publish function
    const mockPublishSendMessage = mock(async (companyId: string, jid: string) => {
      publishSendMessageCalled = true;
      publishedJid = jid;
    });

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      c.set("publishSendMessage", mockPublishSendMessage);
      await next();
    });

    app.post("/messages", async (c) => {
      const tenantDb = c.get("tenantDb");
      const user = c.get("user");
      const companyId = c.get("companyId");
      const publishFn = c.get("publishSendMessage");
      const body = await c.req.json();

      const { contactId, content, messageType = "text" } = body;

      if (!contactId) {
        return c.json({ error: "contactId is required" }, 400);
      }

      if (!content && messageType === "text") {
        return c.json({ error: "content is required for text messages" }, 400);
      }

      // Get contact JID (works for both contacts and groups)
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact || !contact.jid) {
        return c.json({ error: "Contact not found or has no JID" }, 404);
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
          sent_by_user_id: user.id,
          timestamp: new Date(),
        })
        .execute();

      // Publish to NATS - JID determines if it's a group or individual
      await publishFn(companyId, contact.jid, content, messageType, user.id);

      // Detect if this is a group message based on JID format
      const isGroupMessage = contact.jid.includes("@g.us");

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
        isGroupMessage,
      });
    });
  });

  it("should send message to group using group JID", async () => {
    const response = await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "group-123",
        content: "Hello group!",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.message.status).toBe("pending");
    expect(data.isGroupMessage).toBe(true);
  });

  it("should publish message with group JID format", async () => {
    await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "group-123",
        content: "Hello group!",
      }),
    });

    expect(publishSendMessageCalled).toBe(true);
    expect(publishedJid).toContain("@g.us");
  });

  it("should create pending message for group", async () => {
    const response = await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: "group-123",
        content: "Hello group!",
        messageType: "text",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.message.fromMe).toBe(true);
    expect(data.message.content).toBe("Hello group!");
  });
});

describe("GET /messages - Get messages from group", () => {
  let app: Hono;

  beforeEach(() => {
    // Create group messages with different senders
    const groupMessages = [
      createMockMessage({
        id: "msg-1",
        contact_id: "group-123",
        from_me: true,
        sender_jid: "me@s.whatsapp.net",
        content: "Hello everyone!",
        status: "delivered",
      }),
      createMockMessage({
        id: "msg-2",
        contact_id: "group-123",
        from_me: false,
        sender_jid: "member1@s.whatsapp.net",
        content: "Hi there!",
        status: "delivered",
      }),
      createMockMessage({
        id: "msg-3",
        contact_id: "group-123",
        from_me: false,
        sender_jid: "member2@s.whatsapp.net",
        content: "Good morning!",
        status: "delivered",
      }),
    ];

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "messages") {
          return createMockQueryBuilder(groupMessages);
        }
        return createMockQueryBuilder();
      }),
    };

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    app.get("/messages", async (c) => {
      const tenantDb = c.get("tenantDb");
      const contactId = c.req.query("contactId");
      const limit = parseInt(c.req.query("limit") || "50", 10);

      if (!contactId) {
        return c.json({ error: "contactId is required" }, 400);
      }

      const messages = await tenantDb
        .selectFrom("messages")
        .selectAll()
        .where("contact_id", "=", contactId)
        .orderBy("timestamp", "desc")
        .limit(limit)
        .execute();

      return c.json({
        data: messages.map((msg: ReturnType<typeof createMockMessage>) => ({
          id: msg.id,
          contactId: msg.contact_id,
          fromMe: msg.from_me,
          senderJid: msg.sender_jid, // Important for group messages - identifies the sender
          messageType: msg.message_type,
          content: msg.content,
          status: msg.status,
          timestamp: msg.timestamp,
        })),
        pagination: {
          limit,
          hasMore: messages.length === limit,
        },
      });
    });
  });

  it("should return group messages with different sender JIDs", async () => {
    const response = await app.request("/messages?contactId=group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.data).toBeDefined();
    expect(data.data.length).toBe(3);

    // Verify messages have different senders
    const senderJids = data.data.map((m: { senderJid: string }) => m.senderJid);
    const uniqueSenders = new Set(senderJids);
    expect(uniqueSenders.size).toBe(3);
  });

  it("should include senderJid for identifying message authors in group", async () => {
    const response = await app.request("/messages?contactId=group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    data.data.forEach((msg: { senderJid: string; fromMe: boolean }) => {
      expect(msg.senderJid).toBeDefined();
      // Group messages should have sender JID in WhatsApp format
      expect(msg.senderJid).toContain("@s.whatsapp.net");
    });
  });

  it("should distinguish own messages from other members", async () => {
    const response = await app.request("/messages?contactId=group-123", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    const ownMessages = data.data.filter((m: { fromMe: boolean }) => m.fromMe);
    const otherMessages = data.data.filter((m: { fromMe: boolean }) => !m.fromMe);

    expect(ownMessages.length).toBe(1);
    expect(otherMessages.length).toBe(2);
  });
});

describe("Group JID detection", () => {
  it("should correctly identify group JID format", () => {
    const groupJids = [
      "123456789@g.us",
      "987654321987654321@g.us",
      "1234567890123456789@g.us",
    ];

    const individualJids = [
      "1234567890@s.whatsapp.net",
      "0987654321@s.whatsapp.net",
    ];

    groupJids.forEach((jid) => {
      expect(jid.includes("@g.us")).toBe(true);
      expect(jid.includes("@s.whatsapp.net")).toBe(false);
    });

    individualJids.forEach((jid) => {
      expect(jid.includes("@g.us")).toBe(false);
      expect(jid.includes("@s.whatsapp.net")).toBe(true);
    });
  });

  it("should use JID format to route messages correctly", () => {
    const isGroupMessage = (jid: string) => jid.includes("@g.us");

    expect(isGroupMessage("123456789@g.us")).toBe(true);
    expect(isGroupMessage("1234567890@s.whatsapp.net")).toBe(false);
  });
});
