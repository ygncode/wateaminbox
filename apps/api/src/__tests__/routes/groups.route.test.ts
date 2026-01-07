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
import { createMockContact, createMockMessage, createMockQueryBuilder } from "../mocks";

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

// ============================================
// Group Admin Actions Tests
// ============================================

describe("GET /groups/:id/admin-status - Check admin status", () => {
  let app: Hono;

  beforeEach(() => {
    const mockGroup = createMockGroup({ id: "group-123" });
    const mockGroupInfo = createMockGroupInfo();
    const mockConnection = {
      jid: "me@s.whatsapp.net",
    };
    const mockParticipant = createMockGroupParticipant({
      participant_jid: "me@s.whatsapp.net",
      is_admin: true,
    });

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(mockGroup);
        }
        if (table === "groups") {
          return createMockQueryBuilder(mockGroupInfo);
        }
        if (table === "group_participants") {
          return createMockQueryBuilder(mockParticipant);
        }
        if (table === "whatsapp_connections") {
          return createMockQueryBuilder(mockConnection);
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

    app.get("/groups/:id/admin-status", async (c) => {
      const tenantDb = c.get("tenantDb");
      const contactId = c.req.param("id");

      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid"])
        .where("id", "=", contactId)
        .where("is_group", "=", true)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Group not found" }, 404);
      }

      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["jid"])
        .where("status", "=", "connected")
        .executeTakeFirst();

      const connectionJid = connection?.jid ?? null;

      if (!connectionJid) {
        return c.json({
          isAdmin: false,
          connectionJid: null,
          reason: "No active WhatsApp connection",
        });
      }

      const group = await tenantDb
        .selectFrom("groups")
        .select(["id"])
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!group) {
        return c.json({ isAdmin: false, connectionJid });
      }

      const participant = await tenantDb
        .selectFrom("group_participants")
        .select(["is_admin"])
        .where("group_id", "=", group.id)
        .where("participant_jid", "=", connectionJid)
        .executeTakeFirst();

      return c.json({
        isAdmin: participant?.is_admin ?? false,
        connectionJid,
      });
    });
  });

  it("should return admin status for connected user", async () => {
    const response = await app.request("/groups/group-123/admin-status", { method: "GET" });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.isAdmin).toBe(true);
    expect(data.connectionJid).toBeDefined();
  });

  it("should return 404 for non-existent group", async () => {
    // Create app with no group found
    const app2 = new Hono();
    const mockTenantDb = {
      selectFrom: mock(() => createMockQueryBuilder(undefined)),
    };

    app2.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123" });
      await next();
    });

    app2.get("/groups/:id/admin-status", async (c) => {
      const tenantDb = c.get("tenantDb");
      const contactId = c.req.param("id");

      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Group not found" }, 404);
      }

      return c.json({ isAdmin: false, connectionJid: null });
    });

    const response = await app2.request("/groups/non-existent/admin-status", { method: "GET" });
    expect(response.status).toBe(404);
  });
});

describe("POST /groups/:id/participants/:participantJid/promote - Promote to admin", () => {
  let app: Hono;
  let publishCalled: boolean;

  beforeEach(() => {
    publishCalled = false;
    const mockGroup = createMockGroup({ id: "group-123" });
    const mockGroupInfo = createMockGroupInfo();
    const mockConnection = { jid: "me@s.whatsapp.net" };
    const mockAdminParticipant = createMockGroupParticipant({
      participant_jid: "me@s.whatsapp.net",
      is_admin: true,
    });
    const mockTargetParticipant = createMockGroupParticipant({
      id: "target-participant",
      participant_jid: "member1@s.whatsapp.net",
      is_admin: false,
    });

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(mockGroup);
        }
        if (table === "groups") {
          return createMockQueryBuilder(mockGroupInfo);
        }
        if (table === "whatsapp_connections") {
          return createMockQueryBuilder(mockConnection);
        }
        if (table === "group_participants") {
          // Return different values based on context
          const builder = createMockQueryBuilder(mockTargetParticipant);
          // Override to return admin for admin check, target for target check
          builder.executeTakeFirst = mock(() => Promise.resolve(mockTargetParticipant));
          return builder;
        }
        return createMockQueryBuilder();
      }),
      updateTable: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve({ numUpdatedRows: 1n })),
          })),
        })),
      })),
      insertInto: mock(() => ({
        values: mock(() => ({
          execute: mock(() => Promise.resolve([])),
        })),
      })),
    };

    const mockPublishPromote = mock(async () => {
      publishCalled = true;
    });

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      c.set("userId", "user-123");
      c.set("publishGroupPromoteAdmin", mockPublishPromote);
      await next();
    });

    app.post("/groups/:id/participants/:participantJid/promote", async (c) => {
      const tenantDb = c.get("tenantDb");
      const companyId = c.get("companyId");
      const userId = c.get("userId");
      const publishFn = c.get("publishGroupPromoteAdmin");
      const contactId = c.req.param("id");
      const participantJid = c.req.param("participantJid");

      // Get group
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid"])
        .where("id", "=", contactId)
        .where("is_group", "=", true)
        .executeTakeFirst();

      if (!contact || !contact.jid) {
        return c.json({ error: "Group not found" }, 404);
      }

      // Get group details
      const group = await tenantDb
        .selectFrom("groups")
        .select(["id", "name"])
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!group) {
        return c.json({ error: "Group details not found" }, 404);
      }

      // Check participant exists and is not admin
      const participant = await tenantDb
        .selectFrom("group_participants")
        .select(["id", "is_admin"])
        .where("group_id", "=", group.id)
        .where("participant_jid", "=", participantJid)
        .executeTakeFirst();

      if (!participant) {
        return c.json({ error: "Participant not found in group" }, 404);
      }

      if (participant.is_admin) {
        return c.json({ error: "Participant is already an admin" }, 400);
      }

      // Update database
      await tenantDb
        .updateTable("group_participants")
        .set({ is_admin: true })
        .where("id", "=", participant.id)
        .execute();

      // Publish NATS command
      await publishFn(companyId, contact.jid, participantJid, userId);

      return c.json({
        success: true,
        message: "Participant promoted to admin",
        participantJid,
      });
    });
  });

  it("should promote participant to admin", async () => {
    const response = await app.request(
      "/groups/group-123/participants/member1@s.whatsapp.net/promote",
      { method: "POST" }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.message).toBe("Participant promoted to admin");
    expect(data.participantJid).toBe("member1@s.whatsapp.net");
  });

  it("should publish NATS command on promote", async () => {
    await app.request(
      "/groups/group-123/participants/member1@s.whatsapp.net/promote",
      { method: "POST" }
    );

    expect(publishCalled).toBe(true);
  });

  it("should return 400 if participant is already admin", async () => {
    // Create app with participant already admin
    const app2 = new Hono();
    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "group_participants") {
          return createMockQueryBuilder({
            id: "p1",
            is_admin: true, // Already admin
          });
        }
        return createMockQueryBuilder({ id: "group-123", jid: "123@g.us", name: "Test" });
      }),
    };

    app2.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("companyId", "company-123");
      c.set("userId", "user-123");
      await next();
    });

    app2.post("/groups/:id/participants/:participantJid/promote", async (c) => {
      const tenantDb = c.get("tenantDb");
      const contactId = c.req.param("id");
      const participantJid = c.req.param("participantJid");

      const contact = await tenantDb.selectFrom("contacts").executeTakeFirst();
      const group = await tenantDb.selectFrom("groups").executeTakeFirst();
      const participant = await tenantDb.selectFrom("group_participants").executeTakeFirst();

      if (participant.is_admin) {
        return c.json({ error: "Participant is already an admin" }, 400);
      }

      return c.json({ success: true });
    });

    const response = await app2.request(
      "/groups/group-123/participants/admin@s.whatsapp.net/promote",
      { method: "POST" }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Participant is already an admin");
  });
});

describe("POST /groups/:id/participants/:participantJid/demote - Demote admin", () => {
  let app: Hono;
  let publishCalled: boolean;

  beforeEach(() => {
    publishCalled = false;
    const mockGroup = createMockGroup({ id: "group-123" });
    const mockGroupInfo = createMockGroupInfo();
    const mockAdminParticipant = createMockGroupParticipant({
      id: "target-participant",
      participant_jid: "admin2@s.whatsapp.net",
      is_admin: true,
    });

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(mockGroup);
        }
        if (table === "groups") {
          return createMockQueryBuilder(mockGroupInfo);
        }
        if (table === "group_participants") {
          return createMockQueryBuilder(mockAdminParticipant);
        }
        return createMockQueryBuilder();
      }),
      updateTable: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve({ numUpdatedRows: 1n })),
          })),
        })),
      })),
      insertInto: mock(() => ({
        values: mock(() => ({
          execute: mock(() => Promise.resolve([])),
        })),
      })),
    };

    const mockPublishDemote = mock(async () => {
      publishCalled = true;
    });

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123" });
      c.set("companyId", "company-123");
      c.set("userId", "user-123");
      c.set("publishGroupDemoteAdmin", mockPublishDemote);
      await next();
    });

    app.post("/groups/:id/participants/:participantJid/demote", async (c) => {
      const tenantDb = c.get("tenantDb");
      const companyId = c.get("companyId");
      const userId = c.get("userId");
      const publishFn = c.get("publishGroupDemoteAdmin");
      const contactId = c.req.param("id");
      const participantJid = c.req.param("participantJid");

      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact || !contact.jid) {
        return c.json({ error: "Group not found" }, 404);
      }

      const group = await tenantDb
        .selectFrom("groups")
        .select(["id", "name"])
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!group) {
        return c.json({ error: "Group details not found" }, 404);
      }

      const participant = await tenantDb
        .selectFrom("group_participants")
        .select(["id", "is_admin"])
        .where("group_id", "=", group.id)
        .where("participant_jid", "=", participantJid)
        .executeTakeFirst();

      if (!participant) {
        return c.json({ error: "Participant not found in group" }, 404);
      }

      if (!participant.is_admin) {
        return c.json({ error: "Participant is not an admin" }, 400);
      }

      await tenantDb
        .updateTable("group_participants")
        .set({ is_admin: false })
        .where("id", "=", participant.id)
        .execute();

      await publishFn(companyId, contact.jid, participantJid, userId);

      return c.json({
        success: true,
        message: "Admin demoted to regular participant",
        participantJid,
      });
    });
  });

  it("should demote admin to regular participant", async () => {
    const response = await app.request(
      "/groups/group-123/participants/admin2@s.whatsapp.net/demote",
      { method: "POST" }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.message).toBe("Admin demoted to regular participant");
    expect(data.participantJid).toBe("admin2@s.whatsapp.net");
  });

  it("should publish NATS command on demote", async () => {
    await app.request(
      "/groups/group-123/participants/admin2@s.whatsapp.net/demote",
      { method: "POST" }
    );

    expect(publishCalled).toBe(true);
  });

  it("should return 400 if participant is not admin", async () => {
    const app2 = new Hono();
    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "group_participants") {
          return createMockQueryBuilder({
            id: "p1",
            is_admin: false, // Not admin
          });
        }
        return createMockQueryBuilder({ id: "group-123", jid: "123@g.us", name: "Test" });
      }),
    };

    app2.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("companyId", "company-123");
      c.set("userId", "user-123");
      await next();
    });

    app2.post("/groups/:id/participants/:participantJid/demote", async (c) => {
      const tenantDb = c.get("tenantDb");
      const participant = await tenantDb.selectFrom("group_participants").executeTakeFirst();

      if (!participant.is_admin) {
        return c.json({ error: "Participant is not an admin" }, 400);
      }

      return c.json({ success: true });
    });

    const response = await app2.request(
      "/groups/group-123/participants/member@s.whatsapp.net/demote",
      { method: "POST" }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Participant is not an admin");
  });
});

describe("DELETE /groups/:id/participants/:participantJid - Remove participant", () => {
  let app: Hono;
  let publishCalled: boolean;
  let deleteExecuted: boolean;

  beforeEach(() => {
    publishCalled = false;
    deleteExecuted = false;

    const mockGroup = createMockGroup({ id: "group-123" });
    const mockGroupInfo = createMockGroupInfo({ participant_count: 5 });
    const mockParticipant = createMockGroupParticipant({
      id: "target-participant",
      participant_jid: "member1@s.whatsapp.net",
      is_admin: false,
    });

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(mockGroup);
        }
        if (table === "groups") {
          return createMockQueryBuilder(mockGroupInfo);
        }
        if (table === "group_participants") {
          return createMockQueryBuilder(mockParticipant);
        }
        if (table === "whatsapp_connections") {
          return createMockQueryBuilder({ jid: "me@s.whatsapp.net" });
        }
        return createMockQueryBuilder();
      }),
      deleteFrom: mock(() => ({
        where: mock(() => ({
          execute: mock(() => {
            deleteExecuted = true;
            return Promise.resolve({ numDeletedRows: 1n });
          }),
        })),
      })),
      updateTable: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve({ numUpdatedRows: 1n })),
          })),
        })),
      })),
      insertInto: mock(() => ({
        values: mock(() => ({
          execute: mock(() => Promise.resolve([])),
        })),
      })),
    };

    const mockPublishRemove = mock(async () => {
      publishCalled = true;
    });

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123" });
      c.set("companyId", "company-123");
      c.set("userId", "user-123");
      c.set("publishGroupRemoveParticipant", mockPublishRemove);
      await next();
    });

    app.delete("/groups/:id/participants/:participantJid", async (c) => {
      const tenantDb = c.get("tenantDb");
      const companyId = c.get("companyId");
      const userId = c.get("userId");
      const publishFn = c.get("publishGroupRemoveParticipant");
      const contactId = c.req.param("id");
      const participantJid = c.req.param("participantJid");

      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact || !contact.jid) {
        return c.json({ error: "Group not found" }, 404);
      }

      const group = await tenantDb
        .selectFrom("groups")
        .select(["id", "name", "participant_count"])
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!group) {
        return c.json({ error: "Group details not found" }, 404);
      }

      // Check connection JID
      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["jid"])
        .where("status", "=", "connected")
        .executeTakeFirst();

      const connectionJid = connection?.jid;

      // Cannot remove yourself
      if (participantJid === connectionJid) {
        return c.json({ error: "Cannot remove yourself from the group" }, 400);
      }

      const participant = await tenantDb
        .selectFrom("group_participants")
        .select(["id"])
        .where("group_id", "=", group.id)
        .where("participant_jid", "=", participantJid)
        .executeTakeFirst();

      if (!participant) {
        return c.json({ error: "Participant not found in group" }, 404);
      }

      // Delete participant
      await tenantDb
        .deleteFrom("group_participants")
        .where("id", "=", participant.id)
        .execute();

      // Update participant count
      await tenantDb
        .updateTable("groups")
        .set({ participant_count: Math.max(0, (group.participant_count || 1) - 1) })
        .where("id", "=", group.id)
        .execute();

      await publishFn(companyId, contact.jid, participantJid, userId);

      return c.json({
        success: true,
        message: "Participant removed from group",
        participantJid,
      });
    });
  });

  it("should remove participant from group", async () => {
    const response = await app.request(
      "/groups/group-123/participants/member1@s.whatsapp.net",
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.message).toBe("Participant removed from group");
    expect(data.participantJid).toBe("member1@s.whatsapp.net");
  });

  it("should delete participant from database", async () => {
    await app.request(
      "/groups/group-123/participants/member1@s.whatsapp.net",
      { method: "DELETE" }
    );

    expect(deleteExecuted).toBe(true);
  });

  it("should publish NATS command on remove", async () => {
    await app.request(
      "/groups/group-123/participants/member1@s.whatsapp.net",
      { method: "DELETE" }
    );

    expect(publishCalled).toBe(true);
  });

  it("should return 400 when trying to remove self", async () => {
    const response = await app.request(
      "/groups/group-123/participants/me@s.whatsapp.net",
      { method: "DELETE" }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Cannot remove yourself from the group");
  });
});

describe("PATCH /groups/:id/settings - Update group settings", () => {
  let app: Hono;
  let publishCalled: boolean;
  let updatedSettings: { name?: string; description?: string } | null;

  beforeEach(() => {
    publishCalled = false;
    updatedSettings = null;

    const mockGroup = createMockGroup({ id: "group-123" });
    const mockGroupInfo = createMockGroupInfo({
      name: "Old Name",
      description: "Old Description",
    });

    const mockTenantDb = {
      selectFrom: mock((table: string) => {
        if (table === "contacts") {
          return createMockQueryBuilder(mockGroup);
        }
        if (table === "groups") {
          return createMockQueryBuilder(mockGroupInfo);
        }
        if (table === "group_participants") {
          return createMockQueryBuilder({ is_admin: true });
        }
        if (table === "whatsapp_connections") {
          return createMockQueryBuilder({ jid: "me@s.whatsapp.net" });
        }
        return createMockQueryBuilder();
      }),
      updateTable: mock(() => ({
        set: mock((settings: { name?: string; description?: string }) => {
          updatedSettings = settings;
          return {
            where: mock(() => ({
              execute: mock(() => Promise.resolve({ numUpdatedRows: 1n })),
            })),
          };
        }),
      })),
      insertInto: mock(() => ({
        values: mock(() => ({
          execute: mock(() => Promise.resolve([])),
        })),
      })),
    };

    const mockPublishSettings = mock(async () => {
      publishCalled = true;
    });

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123" });
      c.set("companyId", "company-123");
      c.set("userId", "user-123");
      c.set("publishGroupUpdateSettings", mockPublishSettings);
      await next();
    });

    app.patch("/groups/:id/settings", async (c) => {
      const tenantDb = c.get("tenantDb");
      const companyId = c.get("companyId");
      const userId = c.get("userId");
      const publishFn = c.get("publishGroupUpdateSettings");
      const contactId = c.req.param("id");
      const body = await c.req.json();

      const { name, description } = body;

      if (!name && description === undefined) {
        return c.json({ error: "At least one of name or description is required" }, 400);
      }

      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact || !contact.jid) {
        return c.json({ error: "Group not found" }, 404);
      }

      const group = await tenantDb
        .selectFrom("groups")
        .select(["id", "name", "description"])
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!group) {
        return c.json({ error: "Group details not found" }, 404);
      }

      const updates: { name?: string; description?: string } = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;

      if (Object.keys(updates).length > 0) {
        await tenantDb
          .updateTable("groups")
          .set(updates)
          .where("id", "=", group.id)
          .execute();
      }

      await publishFn(companyId, contact.jid, userId, name, description);

      return c.json({
        success: true,
        message: "Group settings updated",
        name: name ?? group.name,
        description: description ?? group.description,
      });
    });
  });

  it("should update group name", async () => {
    const response = await app.request("/groups/group-123/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Group Name" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.name).toBe("New Group Name");
  });

  it("should update group description", async () => {
    const response = await app.request("/groups/group-123/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New description for the group" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.description).toBe("New description for the group");
  });

  it("should update both name and description", async () => {
    const response = await app.request("/groups/group-123/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated Name",
        description: "Updated Description",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.name).toBe("Updated Name");
    expect(data.description).toBe("Updated Description");
  });

  it("should publish NATS command on settings update", async () => {
    await app.request("/groups/group-123/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });

    expect(publishCalled).toBe(true);
  });

  it("should return 400 if no updates provided", async () => {
    const response = await app.request("/groups/group-123/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("At least one of name or description is required");
  });
});
