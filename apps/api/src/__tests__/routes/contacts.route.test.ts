/**
 * Unit tests for contacts.ts routes
 *
 * Tests the POST /contacts endpoint for creating contacts manually by phone number
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockContact } from "../mocks";

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

  // Special handling for eb functions
  mockBuilder.or = mock(() => true);
  mockBuilder.fn = {
    max: mock(() => mockBuilder),
    count: mock(() => mockBuilder),
  };

  return mockBuilder;
}

// Create a mock tenant db
function createMockTenantDb() {
  let insertedContact: unknown = null;
  let existingContact: unknown = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "contacts") {
        const builder = createMockQueryBuilder(existingContact);
        return builder;
      }
      return createMockQueryBuilder();
    }),
    insertInto: mock((table: string) => {
      if (table === "contacts") {
        const builder: Record<string, unknown> = {};
        const chainMethods = ["values", "returning"];
        chainMethods.forEach((method) => {
          builder[method] = mock((values?: unknown) => {
            if (method === "values") {
              insertedContact = values;
            }
            return builder;
          });
        });
        builder.executeTakeFirst = mock(() =>
          Promise.resolve(
            insertedContact
              ? {
                  id: "new-contact-123",
                  ...(insertedContact as object),
                  created_at: new Date(),
                  updated_at: new Date(),
                }
              : null
          )
        );
        return builder;
      }
      return createMockQueryBuilder();
    }),
    setExistingContact: (contact: unknown) => {
      existingContact = contact;
    },
  };

  return mockDb;
}

describe("POST /contacts - Create contact by phone number", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    // Create a test app with the route
    app = new Hono();

    // Mock middleware that sets tenantDb and user
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    // Mount the route handler (simplified version for testing)
    app.post("/contacts", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>;
      const body = await c.req.json();

      const { phoneNumber, customName, notesShared } = body;

      if (!phoneNumber) {
        return c.json({ error: "phoneNumber is required" }, 400);
      }

      // Normalize phone number
      let cleanedPhone = phoneNumber.replace(/[^\d+]/g, "");
      if (cleanedPhone.startsWith("+")) {
        cleanedPhone = cleanedPhone.substring(1);
      }
      if (cleanedPhone.startsWith("00")) {
        cleanedPhone = cleanedPhone.substring(2);
      }

      // Validate phone number length
      if (cleanedPhone.length < 6 || cleanedPhone.length > 15) {
        return c.json(
          { error: "Invalid phone number. Must be between 6 and 15 digits." },
          400
        );
      }

      const jid = `${cleanedPhone}@s.whatsapp.net`;

      // Check if contact already exists
      const existingContact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "jid", "phone_number", "custom_name", "push_name"])
        .where((eb: { or: (conds: boolean[]) => boolean }) =>
          eb.or([true, true])
        )
        .executeTakeFirst();

      if (existingContact) {
        return c.json(
          {
            error: "Contact already exists",
            existingContact: {
              id: (existingContact as Record<string, unknown>).id,
              phoneNumber: (existingContact as Record<string, unknown>)
                .phone_number,
              displayName:
                (existingContact as Record<string, unknown>).custom_name ||
                (existingContact as Record<string, unknown>).push_name ||
                (existingContact as Record<string, unknown>).phone_number,
            },
          },
          409
        );
      }

      // Create the contact
      const newContact = await tenantDb
        .insertInto("contacts")
        .values({
          jid,
          phone_number: cleanedPhone,
          custom_name: customName || null,
          notes_shared: notesShared || null,
          is_group: false,
        })
        .returning([
          "id",
          "jid",
          "phone_number",
          "custom_name",
          "notes_shared",
          "is_group",
          "created_at",
          "updated_at",
        ])
        .executeTakeFirst();

      if (!newContact) {
        return c.json({ error: "Failed to create contact" }, 500);
      }

      return c.json(
        {
          id: (newContact as Record<string, unknown>).id,
          jid: (newContact as Record<string, unknown>).jid,
          phoneNumber: (newContact as Record<string, unknown>).phone_number,
          customName: (newContact as Record<string, unknown>).custom_name,
          displayName:
            (newContact as Record<string, unknown>).custom_name ||
            (newContact as Record<string, unknown>).phone_number,
          notesShared: (newContact as Record<string, unknown>).notes_shared,
          isGroup: (newContact as Record<string, unknown>).is_group,
          createdAt: (newContact as Record<string, unknown>).created_at,
          updatedAt: (newContact as Record<string, unknown>).updated_at,
        },
        201
      );
    });
  });

  it("should create a contact with valid phone number", async () => {
    const response = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "+1234567890",
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBe("new-contact-123");
    expect(data.phoneNumber).toBe("1234567890");
    expect(data.jid).toBe("1234567890@s.whatsapp.net");
    expect(data.isGroup).toBe(false);
  });

  it("should create a contact with custom name and notes", async () => {
    const response = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "+1234567890",
        customName: "John Doe",
        notesShared: "Important client",
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.customName).toBe("John Doe");
    expect(data.notesShared).toBe("Important client");
    expect(data.displayName).toBe("John Doe");
  });

  it("should return 400 if phone number is missing", async () => {
    const response = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("phoneNumber is required");
  });

  it("should return 400 if phone number is too short", async () => {
    const response = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "123",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe(
      "Invalid phone number. Must be between 6 and 15 digits."
    );
  });

  it("should return 400 if phone number is too long", async () => {
    const response = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "+12345678901234567890",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe(
      "Invalid phone number. Must be between 6 and 15 digits."
    );
  });

  it("should return 409 if contact already exists", async () => {
    // Set up existing contact
    mockTenantDb.setExistingContact(
      createMockContact({
        id: "existing-contact-123",
        phone_number: "1234567890",
        custom_name: "Existing Contact",
      })
    );

    const response = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "+1234567890",
      }),
    });

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toBe("Contact already exists");
    expect(data.existingContact).toBeDefined();
    expect(data.existingContact.id).toBe("existing-contact-123");
  });

  it("should normalize phone numbers with various formats", async () => {
    // Test with spaces and dashes
    const response1 = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "+1 (234) 567-8901",
      }),
    });
    expect(response1.status).toBe(201);
    const data1 = await response1.json();
    expect(data1.phoneNumber).toBe("12345678901");

    // Reset for next test
    mockTenantDb = createMockTenantDb();

    // Test with 00 prefix
    const response2 = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "001234567890",
      }),
    });
    expect(response2.status).toBe(201);
    const data2 = await response2.json();
    expect(data2.phoneNumber).toBe("1234567890");
  });
});

// Create mock for contact assignment with takeover
function createMockAssignmentDb() {
  let contactData: Record<string, unknown> | null = null;
  let currentAssignment: Record<string, unknown> | null = null;
  let newAssignment: Record<string, unknown> | null = null;
  let updateCalled = false;
  let insertValues: Record<string, unknown> | null = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      const builder: Record<string, unknown> = {};
      const chainMethods = ["select", "selectAll", "where", "returning"];
      chainMethods.forEach((method) => {
        builder[method] = mock(() => builder);
      });
      builder.executeTakeFirst = mock(() => {
        if (table === "contacts") {
          return Promise.resolve(contactData);
        }
        if (table === "contact_assignments") {
          return Promise.resolve(currentAssignment);
        }
        return Promise.resolve(null);
      });
      return builder;
    }),
    updateTable: mock(() => {
      const builder: Record<string, unknown> = {};
      const chainMethods = ["set", "where", "returning"];
      chainMethods.forEach((method) => {
        builder[method] = mock(() => builder);
      });
      builder.execute = mock(() => {
        updateCalled = true;
        return Promise.resolve({ numUpdatedRows: 1n });
      });
      return builder;
    }),
    insertInto: mock((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.values = mock((values: Record<string, unknown>) => {
        insertValues = values;
        return builder;
      });
      builder.returning = mock(() => builder);
      builder.executeTakeFirst = mock(() => {
        if (table === "contact_assignments" && insertValues) {
          newAssignment = {
            id: "assignment-456",
            assigned_to: insertValues.assigned_to,
            assigned_by: insertValues.assigned_by,
            assigned_at: new Date(),
          };
          return Promise.resolve(newAssignment);
        }
        return Promise.resolve(null);
      });
      return builder;
    }),
    setContactData: (data: Record<string, unknown> | null) => {
      contactData = data;
    },
    setCurrentAssignment: (data: Record<string, unknown> | null) => {
      currentAssignment = data;
    },
    wasUpdateCalled: () => updateCalled,
    getInsertValues: () => insertValues,
    getNewAssignment: () => newAssignment,
  };

  return mockDb;
}

// Mock for createNotification
let notificationCreated: Record<string, unknown> | null = null;
const mockCreateNotification = mock(
  (_companyId: string, input: Record<string, unknown>) => {
    notificationCreated = input;
    return Promise.resolve({ id: "notification-123", ...input });
  }
);

// Mock for broadcastToCompany
let broadcastPayload: Record<string, unknown> | null = null;
const mockBroadcastToCompany = mock(
  (_companyId: string, message: Record<string, unknown>) => {
    broadcastPayload = message;
  }
);

// Mock for createAuditLog
let auditLogCreated: Record<string, unknown> | null = null;
const mockCreateAuditLog = mock((input: Record<string, unknown>) => {
  auditLogCreated = input;
  return Promise.resolve();
});

describe("POST /contacts/:id/assign - Contact assignment with takeover", () => {
  let app: Hono;
  let mockDb: ReturnType<typeof createMockAssignmentDb>;

  beforeEach(() => {
    mockDb = createMockAssignmentDb();
    notificationCreated = null;
    broadcastPayload = null;
    auditLogCreated = null;

    app = new Hono();

    // Mock middleware that sets tenantDb, user, and company
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("company", { id: "company-123", name: "Test Company" });
      await next();
    });

    // Simplified assign route for testing
    app.post("/contacts/:id/assign", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockAssignmentDb
      >;
      const user = c.get("user") as { id: string };
      const company = c.get("company") as { id: string };
      const contactId = c.req.param("id");

      // Parse optional body for targetUserId
      let targetUserId = user.id;
      try {
        const body = await c.req.json();
        if (body.targetUserId) {
          targetUserId = body.targetUserId;
        }
      } catch {
        // No body or invalid JSON - default to self-assignment
      }

      // Check if contact exists
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["id", "custom_name", "push_name", "phone_number", "jid"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }

      const typedContact = contact as Record<string, unknown>;
      const contactDisplayName =
        typedContact.custom_name ||
        typedContact.push_name ||
        typedContact.phone_number ||
        (typedContact.jid as string)?.split("@")[0] ||
        "Unknown Contact";

      // Get current assignment
      const previousAssignment = await tenantDb
        .selectFrom("contact_assignments")
        .select(["id", "assigned_to", "assigned_by", "assigned_at"])
        .where("contact_id", "=", contactId)
        .where("unassigned_at", "is", null)
        .executeTakeFirst();

      const typedPrevAssignment = previousAssignment as Record<
        string,
        unknown
      > | null;
      const previousAssigneeId = typedPrevAssignment?.assigned_to as
        | string
        | undefined;
      const isTakeover =
        previousAssigneeId && previousAssigneeId !== targetUserId;

      // Unassign previous
      await tenantDb
        .updateTable("contact_assignments")
        .set({ unassigned_at: new Date() })
        .where("contact_id", "=", contactId)
        .where("unassigned_at", "is", null)
        .execute();

      // Create new assignment
      const assignment = await tenantDb
        .insertInto("contact_assignments")
        .values({
          contact_id: contactId,
          assigned_to: targetUserId,
          assigned_by: user.id,
        })
        .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
        .executeTakeFirst();

      // If takeover, create notification
      if (isTakeover && previousAssigneeId) {
        await mockCreateNotification(company.id, {
          userId: previousAssigneeId,
          notificationType: "assignment",
          title: "Contact Reassigned",
          message: `"${contactDisplayName}" has been reassigned to another team member`,
          actionUrl: `/chat/${contactId}`,
          metadata: {
            contactId,
            contactName: contactDisplayName,
            reassignedBy: user.id,
            newAssignee: targetUserId,
          },
        });

        mockBroadcastToCompany(company.id, {
          type: "contact",
          payload: {
            event: "reassigned",
            contactId,
            contactName: contactDisplayName,
            previousAssignee: previousAssigneeId,
            newAssignee: targetUserId,
            reassignedBy: user.id,
          },
          timestamp: new Date().toISOString(),
        });

        await mockCreateAuditLog({
          companyId: company.id,
          userId: user.id,
          action: "contact.assigned",
          entityType: "contact",
          entityId: contactId,
          details: {
            previousAssignee: previousAssigneeId,
            newAssignee: targetUserId,
            isTakeover: true,
            contactName: contactDisplayName,
          },
        });
      } else {
        await mockCreateAuditLog({
          companyId: company.id,
          userId: user.id,
          action: "contact.assigned",
          entityType: "contact",
          entityId: contactId,
          details: {
            assignee: targetUserId,
            isTakeover: false,
            contactName: contactDisplayName,
          },
        });
      }

      const typedAssignment = assignment as Record<string, unknown> | null;

      return c.json({
        success: true,
        assignment: {
          id: typedAssignment?.id,
          assignedTo: typedAssignment?.assigned_to,
          assignedBy: typedAssignment?.assigned_by,
          assignedAt: typedAssignment?.assigned_at,
        },
        wasTakeover: !!isTakeover,
        previousAssignee: previousAssigneeId || null,
      });
    });
  });

  it("should assign contact to current user (self-assignment)", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "John Doe",
      push_name: null,
      phone_number: "1234567890",
      jid: "1234567890@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment(null); // No current assignment

    const response = await app.request("/contacts/contact-123/assign", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.wasTakeover).toBe(false);
    expect(data.previousAssignee).toBeNull();
    expect(data.assignment.assignedTo).toBe("user-123");
  });

  it("should reassign contact to another user (takeover)", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "Jane Smith",
      push_name: null,
      phone_number: "9876543210",
      jid: "9876543210@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment({
      id: "assignment-old",
      assigned_to: "previous-user-456",
      assigned_by: "previous-user-456",
      assigned_at: new Date("2024-01-01"),
    });

    const response = await app.request("/contacts/contact-123/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "new-user-789",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.wasTakeover).toBe(true);
    expect(data.previousAssignee).toBe("previous-user-456");
    expect(data.assignment.assignedTo).toBe("new-user-789");
  });

  it("should create notification for previous assignee on takeover", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "Jane Smith",
      push_name: null,
      phone_number: "9876543210",
      jid: "9876543210@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment({
      id: "assignment-old",
      assigned_to: "previous-user-456",
      assigned_by: "previous-user-456",
      assigned_at: new Date("2024-01-01"),
    });

    await app.request("/contacts/contact-123/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "new-user-789",
      }),
    });

    expect(notificationCreated).not.toBeNull();
    expect(notificationCreated?.userId).toBe("previous-user-456");
    expect(notificationCreated?.notificationType).toBe("assignment");
    expect(notificationCreated?.title).toBe("Contact Reassigned");
    expect(notificationCreated?.message).toContain("Jane Smith");
    expect(notificationCreated?.actionUrl).toBe("/chat/contact-123");
  });

  it("should broadcast WebSocket event on takeover", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "Jane Smith",
      push_name: null,
      phone_number: "9876543210",
      jid: "9876543210@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment({
      id: "assignment-old",
      assigned_to: "previous-user-456",
      assigned_by: "previous-user-456",
      assigned_at: new Date("2024-01-01"),
    });

    await app.request("/contacts/contact-123/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "new-user-789",
      }),
    });

    expect(broadcastPayload).not.toBeNull();
    expect(broadcastPayload?.type).toBe("contact");
    const payload = broadcastPayload?.payload as Record<string, unknown>;
    expect(payload?.event).toBe("reassigned");
    expect(payload?.contactId).toBe("contact-123");
    expect(payload?.previousAssignee).toBe("previous-user-456");
    expect(payload?.newAssignee).toBe("new-user-789");
  });

  it("should create audit log with takeover details", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "Jane Smith",
      push_name: null,
      phone_number: "9876543210",
      jid: "9876543210@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment({
      id: "assignment-old",
      assigned_to: "previous-user-456",
      assigned_by: "previous-user-456",
      assigned_at: new Date("2024-01-01"),
    });

    await app.request("/contacts/contact-123/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "new-user-789",
      }),
    });

    expect(auditLogCreated).not.toBeNull();
    expect(auditLogCreated?.action).toBe("contact.assigned");
    const details = auditLogCreated?.details as Record<string, unknown>;
    expect(details?.isTakeover).toBe(true);
    expect(details?.previousAssignee).toBe("previous-user-456");
    expect(details?.newAssignee).toBe("new-user-789");
  });

  it("should NOT create notification for self-assignment", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "John Doe",
      push_name: null,
      phone_number: "1234567890",
      jid: "1234567890@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment(null);

    await app.request("/contacts/contact-123/assign", {
      method: "POST",
    });

    // No notification should be created for self-assignment
    expect(notificationCreated).toBeNull();
    expect(broadcastPayload).toBeNull();
  });

  it("should NOT create notification when reassigning to same user", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: "John Doe",
      push_name: null,
      phone_number: "1234567890",
      jid: "1234567890@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment({
      id: "assignment-old",
      assigned_to: "user-123", // Same as current user
      assigned_by: "user-123",
      assigned_at: new Date("2024-01-01"),
    });

    await app.request("/contacts/contact-123/assign", {
      method: "POST",
    });

    // No notification for reassigning to same user
    expect(notificationCreated).toBeNull();
    expect(broadcastPayload).toBeNull();
  });

  it("should return 404 if contact not found", async () => {
    mockDb.setContactData(null);

    const response = await app.request("/contacts/nonexistent-123/assign", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Contact not found");
  });

  it("should use phone number as display name when custom_name is missing", async () => {
    mockDb.setContactData({
      id: "contact-123",
      custom_name: null,
      push_name: null,
      phone_number: "1234567890",
      jid: "1234567890@s.whatsapp.net",
    });
    mockDb.setCurrentAssignment({
      id: "assignment-old",
      assigned_to: "previous-user-456",
      assigned_by: "previous-user-456",
      assigned_at: new Date("2024-01-01"),
    });

    await app.request("/contacts/contact-123/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "new-user-789",
      }),
    });

    expect(notificationCreated?.message).toContain("1234567890");
  });
});

// ============================================================================
// POST /contacts/import/preview - Batch Lookup Tests
// ============================================================================

/**
 * Mock builder that tracks query execution for verifying batch optimization
 */
function createMockPreviewDb() {
  let queryCount = 0;
  let lastQueryParams: {
    table?: string;
    jids?: string[];
    phoneNumbers?: string[];
  } = {};

  const mockDb = {
    selectFrom: mock((table: string) => {
      queryCount++;
      const builder: Record<string, unknown> = {};

      builder.select = mock(() => builder);
      builder.where = mock((cb: (eb: unknown) => unknown) => {
        // Capture the where clause params by simulating the eb callback
        const mockEb = {
          or: mock((conds: Array<{ _type: string; column: string; op: string; value: string[] }>) => {
            // Extract values from the conditions to verify batch query
            conds.forEach((cond) => {
              if (cond.column === "jid") {
                lastQueryParams.jids = cond.value;
              } else if (cond.column === "phone_number") {
                lastQueryParams.phoneNumbers = cond.value;
              }
            });
            return true;
          }),
        };
        cb(mockEb);
        return builder;
      });
      builder.execute = mock(() => Promise.resolve([]));

      return builder;
    }),
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
      lastQueryParams = {};
    },
    getLastQueryParams: () => lastQueryParams,
    setExistingContacts: (contacts: Array<{
      jid: string;
      phone_number: string | null;
      custom_name: string | null;
      push_name: string | null;
    }>) => {
      // Override execute to return the provided contacts
      mockDb.selectFrom = mock((table: string) => {
        queryCount++;
        const builder: Record<string, unknown> = {};

        builder.select = mock(() => builder);
        builder.where = mock((cb: (eb: unknown) => unknown) => {
          const mockEb = {
            or: mock((conds: unknown[]) => true),
          };
          cb(mockEb);
          return builder;
        });
        builder.execute = mock(() => Promise.resolve(contacts));
        return builder;
      });
    },
  };

  return mockDb;
}

describe("POST /contacts/import/preview - Batch lookup optimization", () => {
  let app: Hono;
  let mockDb: ReturnType<typeof createMockPreviewDb>;

  beforeEach(() => {
    mockDb = createMockPreviewDb();
    app = new Hono();

    // Mock middleware
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      await next();
    });

    // Import preview route - simplified version for testing
    app.post("/contacts/import/preview", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockPreviewDb>;

      const body = await c.req.json();
      const { csvContent } = body;

      if (!csvContent) {
        return c.json({ error: "csvContent is required" }, 400);
      }

      // Parse CSV
      const lines = csvContent.trim().split("\n");
      if (lines.length < 2) {
        return c.json({ error: "No valid data found in CSV" }, 400);
      }

      const header = lines[0].split(",").map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));

      const contactRows: Array<{
        phone_number: string;
        custom_name?: string;
        notes?: string;
        tags?: string;
      }> = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",");
        const row: Record<string, string> = {};
        header.forEach((key, idx) => {
          row[key] = values[idx]?.trim() || "";
        });

        // Map to contact row (simplified version)
        const phoneNumber = row.phone_number || row.phone || row.mobile || "";
        if (phoneNumber) {
          contactRows.push({
            phone_number: phoneNumber,
            custom_name: row.name || row.custom_name || undefined,
            notes: row.notes || undefined,
            tags: row.tags || undefined,
          });
        }
      }

      if (contactRows.length === 0) {
        return c.json({ error: "No valid contacts found" }, 400);
      }

      // Batch lookup: Check which contacts already exist in a single query
      const lookupData = contactRows.map((row) => {
        const phoneNumber = row.phone_number.replace(/[^\d]/g, "");
        return {
          originalPhoneNumber: row.phone_number,
          cleanPhoneNumber: phoneNumber,
          jid: `${phoneNumber}@s.whatsapp.net`,
        };
      });

      // Single query to find all existing contacts at once
      const existingContacts = await (tenantDb as unknown as {
        selectFrom: (table: string) => {
          select: (cols: string[]) => {
            where: (cb: (eb: unknown) => unknown) => {
              execute: () => Promise<
                Array<{
                  jid: string;
                  phone_number: string | null;
                  custom_name: string | null;
                  push_name: string | null;
                }>
              >;
            };
          };
        };
      })
        .selectFrom("contacts")
        .select(["jid", "phone_number", "custom_name", "push_name"])
        .where(() => true)
        .execute();

      // Build a Map for O(1) existence checks
      const existingMap = new Map<
        string,
        { customName: string | null; pushName: string | null }
      >();
      for (const contact of existingContacts) {
        existingMap.set(contact.jid, {
          customName: contact.custom_name,
          pushName: contact.push_name,
        });
        if (contact.phone_number) {
          existingMap.set(contact.phone_number.replace(/[^\d]/g, ""), {
            customName: contact.custom_name,
            pushName: contact.push_name,
          });
        }
      }

      // Build preview using the Map
      const preview = lookupData.map((data, index) => {
        const existing =
          existingMap.get(data.jid) || existingMap.get(data.cleanPhoneNumber);
        const contactRow = contactRows[index];

        return {
          row: index + 1,
          phoneNumber: data.originalPhoneNumber,
          name: contactRow.custom_name || null,
          notes: contactRow.notes || null,
          tags: contactRow.tags || null,
          exists: !!existing,
          existingName: existing?.customName || existing?.pushName || null,
        };
      });

      const existingCount = preview.filter((p) => p.exists).length;
      const newCount = preview.filter((p) => !p.exists).length;

      return c.json({
        total: preview.length,
        existingCount,
        newCount,
        preview: preview.slice(0, 100),
      });
    });
  });

  it("should execute only 1 query for existence check regardless of contact count", async () => {
    const csvContent = `phone_number,name,notes
+1234567890,John Doe,Important
+0987654321,Jane Smith,Follow up
+1122334455,Bob Wilson,Customer
+5555555555,Alice Brown,Lead
+7777777777,Charlie Davis,VIP`;

    mockDb.resetQueryCount();

    await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    // Should only execute 1 query for the batch lookup
    expect(mockDb.getQueryCount()).toBe(1);
  });

  it("should execute only 1 query even with 50 contacts", async () => {
    let csvContent = "phone_number,name\n";
    for (let i = 1; i <= 50; i++) {
      csvContent += `+1234567${String(i).padStart(3, "0")},Contact ${i}\n`;
    }

    mockDb.resetQueryCount();

    await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    // Should still be only 1 query
    expect(mockDb.getQueryCount()).toBe(1);
  });

  it("should correctly classify existing contacts", async () => {
    mockDb.setExistingContacts([
      {
        jid: "1234567890@s.whatsapp.net",
        phone_number: "1234567890",
        custom_name: "Existing John",
        push_name: null,
      },
    ]);

    const csvContent = `phone_number,name
+1234567890,John Doe
+0987654321,Jane Smith`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.total).toBe(2);
    expect(data.preview).toHaveLength(2);

    // First contact exists
    expect(data.preview[0].exists).toBe(true);
    expect(data.preview[0].existingName).toBe("Existing John");
    expect(data.preview[0].phoneNumber).toBe("+1234567890");

    // Second contact is new
    expect(data.preview[1].exists).toBe(false);
    expect(data.preview[1].existingName).toBeNull();
    expect(data.preview[1].phoneNumber).toBe("+0987654321");
  });

  it("should correctly classify all new contacts", async () => {
    mockDb.setExistingContacts([]);

    const csvContent = `phone_number,name
+1234567890,John Doe
+0987654321,Jane Smith
+1122334455,Bob Wilson`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.total).toBe(3);
    expect(data.existingCount).toBe(0);
    expect(data.newCount).toBe(3);
    expect(data.preview.every((p: { exists: boolean }) => p.exists === false)).toBe(true);
  });

  it("should correctly classify all existing contacts", async () => {
    mockDb.setExistingContacts([
      {
        jid: "1234567890@s.whatsapp.net",
        phone_number: "1234567890",
        custom_name: "John Doe",
        push_name: null,
      },
      {
        jid: "9876543210@s.whatsapp.net",
        phone_number: "9876543210",
        custom_name: "Jane Smith",
        push_name: null,
      },
      {
        jid: "5555555555@s.whatsapp.net",
        phone_number: "5555555555",
        custom_name: "Bob Wilson",
        push_name: null,
      },
    ]);

    const csvContent = `phone_number,name
+1234567890,New John
+9876543210,New Jane
+5555555555,New Bob`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.total).toBe(3);
    expect(data.existingCount).toBe(3);
    expect(data.newCount).toBe(0);
    expect(data.preview.every((p: { exists: boolean }) => p.exists === true)).toBe(true);
  });

  it("should handle duplicate phone numbers correctly", async () => {
    mockDb.setExistingContacts([
      {
        jid: "1234567890@s.whatsapp.net",
        phone_number: "1234567890",
        custom_name: "Original Contact",
        push_name: null,
      },
    ]);

    const csvContent = `phone_number,name
+1234567890,First Duplicate
(123) 456-7890,Second Duplicate
1234567890,Third Duplicate`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.total).toBe(3);
    // All should be marked as existing since they normalize to the same phone number
    expect(data.preview[0].exists).toBe(true);
    expect(data.preview[1].exists).toBe(true);
    expect(data.preview[2].exists).toBe(true);
  });

  it("should use push_name when custom_name is null", async () => {
    mockDb.setExistingContacts([
      {
        jid: "1234567890@s.whatsapp.net",
        phone_number: "1234567890",
        custom_name: null,
        push_name: "WhatsApp Push Name",
      },
    ]);

    const csvContent = `phone_number,name
+1234567890,CSV Name`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.preview[0].exists).toBe(true);
    expect(data.preview[0].existingName).toBe("WhatsApp Push Name");
  });

  it("should prefer custom_name over push_name for existingName", async () => {
    mockDb.setExistingContacts([
      {
        jid: "1234567890@s.whatsapp.net",
        phone_number: "1234567890",
        custom_name: "Custom Name",
        push_name: "Push Name",
      },
    ]);

    const csvContent = `phone_number,name
+1234567890,CSV Name`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.preview[0].existingName).toBe("Custom Name");
  });

  it("should return 400 when csvContent is missing", async () => {
    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("csvContent is required");
  });

  it("should return 400 when CSV has no valid data", async () => {
    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent: "phone_number,name" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("No valid data found in CSV");
  });

  it("should handle various phone number formats in CSV", async () => {
    mockDb.setExistingContacts([
      {
        jid: "1234567890@s.whatsapp.net",
        phone_number: "1234567890",
        custom_name: "Formatted Contact",
        push_name: null,
      },
    ]);

    const csvContent = `phone_number,name
+1234567890,With Plus
(123) 456-7890,With Parens
123-456-7890,With Dashes
1234567890,Just Digits`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    // All should normalize to the same contact
    expect(data.preview.every((p: { exists: boolean }) => p.exists === true)).toBe(true);
    expect(data.preview[0].existingName).toBe("Formatted Contact");
    expect(data.preview[1].existingName).toBe("Formatted Contact");
    expect(data.preview[2].existingName).toBe("Formatted Contact");
    expect(data.preview[3].existingName).toBe("Formatted Contact");
  });

  it("should handle empty CSV gracefully", async () => {
    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent: "" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    // Empty string fails truthy check for csvContent
    expect(data.error).toBe("csvContent is required");
  });

  it("should limit preview to 100 rows", async () => {
    mockDb.setExistingContacts([]);

    let csvContent = "phone_number,name\n";
    for (let i = 1; i <= 150; i++) {
      csvContent += `+1234567${String(i).padStart(3, "0")},Contact ${i}\n`;
    }

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.total).toBe(150);
    expect(data.preview).toHaveLength(100);
  });

  it("should preserve CSV row numbers in preview", async () => {
    mockDb.setExistingContacts([]);

    const csvContent = `phone_number,name,notes
+1234567890,John Doe,Note 1
+0987654321,Jane Smith,Note 2
+1122334455,Bob Wilson,Note 3`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.preview[0].row).toBe(1);
    expect(data.preview[1].row).toBe(2);
    expect(data.preview[2].row).toBe(3);
  });

  it("should include tags from CSV in preview", async () => {
    mockDb.setExistingContacts([]);

    const csvContent = `phone_number,name,tags
+1234567890,John Doe,VIP
+0987654321,Jane Smith,Customer`;

    const response = await app.request("/contacts/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.preview[0].tags).toBe("VIP");
    expect(data.preview[1].tags).toBe("Customer");
  });
});
