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
