import { describe, expect, test } from "bun:test";
import {
  createCompanySchema,
  inviteMemberSchema,
  listCompanyInvitationsQuerySchema,
  listCompanyMembersQuerySchema,
  updateCompanySchema,
} from "./company.js";

describe("company profile validation", () => {
  test("accepts an optional description and processed image", () => {
    const logoDataUrl = `data:image/webp;base64,${Buffer.from(
      "processed-logo",
    ).toString("base64")}`;

    expect(
      createCompanySchema.parse({
        name: "Northwind Support",
        description: "Customer care and sales conversations.",
        logoDataUrl,
      }),
    ).toEqual({
      name: "Northwind Support",
      description: "Customer care and sales conversations.",
      logoDataUrl,
    });
  });

  test("rejects unsupported or oversized logo payloads", () => {
    expect(
      createCompanySchema.safeParse({
        name: "Northwind",
        logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      }).success,
    ).toBe(false);

    const oversized = `data:image/webp;base64,${Buffer.alloc(
      512 * 1024 + 1,
    ).toString("base64")}`;
    expect(
      createCompanySchema.safeParse({
        name: "Northwind",
        logoDataUrl: oversized,
      }).success,
    ).toBe(false);
  });

  test("enforces the workspace description limit", () => {
    expect(
      createCompanySchema.safeParse({
        name: "Northwind",
        description: "x".repeat(281),
      }).success,
    ).toBe(false);
  });

  test("supports replacing or removing a workspace logo", () => {
    const logoDataUrl = `data:image/webp;base64,${Buffer.from(
      "updated-logo",
    ).toString("base64")}`;

    expect(updateCompanySchema.parse({ logoDataUrl })).toEqual({
      logoDataUrl,
    });
    expect(updateCompanySchema.parse({ logoDataUrl: null })).toEqual({
      logoDataUrl: null,
    });
    expect(
      updateCompanySchema.safeParse({
        logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      }).success,
    ).toBe(false);
  });
});

describe("listCompanyMembersQuerySchema", () => {
  test("normalizes server table search and pagination", () => {
    expect(
      listCompanyMembersQuerySchema.parse({
        search: "  maya  ",
        role: "admin",
        limit: "20",
        offset: "40",
      }),
    ).toEqual({
      search: "maya",
      role: "admin",
      limit: 20,
      offset: 40,
    });
  });

  test("uses safe table defaults", () => {
    expect(listCompanyMembersQuerySchema.parse({})).toEqual({
      search: "",
      role: "all",
      limit: 50,
      offset: 0,
    });
  });
});

describe("listCompanyInvitationsQuerySchema", () => {
  test("normalizes invitation search and pagination", () => {
    expect(
      listCompanyInvitationsQuerySchema.parse({
        search: "  support@example.com  ",
        role: "member",
        limit: "10",
        offset: "20",
      }),
    ).toEqual({
      search: "support@example.com",
      role: "member",
      limit: 10,
      offset: 20,
    });
  });

  test("uses safe invitation table defaults", () => {
    expect(listCompanyInvitationsQuerySchema.parse({})).toEqual({
      search: "",
      role: "all",
      limit: 50,
      offset: 0,
    });
  });
});

describe("inviteMemberSchema", () => {
  test("accepts optional permission overrides", () => {
    expect(
      inviteMemberSchema.parse({
        email: "agent@example.com",
        role: "member",
        permissions: {
          can_send_messages: false,
          can_view_dashboard: true,
        },
      }),
    ).toEqual({
      email: "agent@example.com",
      role: "member",
      permissions: {
        can_send_messages: false,
        can_view_dashboard: true,
      },
    });
  });

  test("rejects unknown permission values", () => {
    expect(
      inviteMemberSchema.safeParse({
        email: "agent@example.com",
        role: "member",
        permissions: { can_export: "yes" },
      }).success,
    ).toBe(false);
  });
});
