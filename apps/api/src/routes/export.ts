import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as exportService from "../services/export.service.js";

export const exportRoutes = new Hono();

// All export routes require authentication and tenant context
exportRoutes.use("/*", authMiddleware);
exportRoutes.use("/*", tenantMiddleware());

/**
 * GET /export/contacts - Export contacts
 * Query params: format (csv|json), tagIds, assignedTo, hasCustomName
 */
exportRoutes.get("/contacts", async (c) => {
  const companyId = c.get("companyId");
  const format = (c.req.query("format") as "csv" | "json") || "csv";
  const tagIds = c.req.query("tagIds")?.split(",").filter(Boolean);
  const assignedTo = c.req.query("assignedTo");
  const hasCustomName = c.req.query("hasCustomName") === "true";

  const contacts = await exportService.exportContacts(companyId, {
    tagIds,
    assignedTo: assignedTo || undefined,
    hasCustomName: hasCustomName || undefined,
  });

  if (format === "json") {
    return c.json({ data: contacts });
  }

  // CSV format
  const csv = exportService.toCSV(
    contacts as unknown as Record<string, unknown>[],
  );
  c.header("Content-Type", "text/csv");
  c.header(
    "Content-Disposition",
    `attachment; filename="contacts-${new Date().toISOString().split("T")[0]}.csv"`,
  );
  return c.body(csv);
});

/**
 * GET /export/messages - Export messages
 * Query params: format (csv|json), contactId, startDate, endDate, messageTypes, limit
 */
exportRoutes.get("/messages", async (c) => {
  const companyId = c.get("companyId");
  const format = (c.req.query("format") as "csv" | "json") || "csv";
  const contactId = c.req.query("contactId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const messageTypes = c.req.query("messageTypes")?.split(",").filter(Boolean);
  const limitStr = c.req.query("limit");

  const messages = await exportService.exportMessages(companyId, {
    contactId: contactId || undefined,
    startDate: startDateStr ? new Date(startDateStr) : undefined,
    endDate: endDateStr ? new Date(endDateStr) : undefined,
    messageTypes,
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
  });

  if (format === "json") {
    return c.json({ data: messages });
  }

  // CSV format
  const csv = exportService.toCSV(
    messages as unknown as Record<string, unknown>[],
  );
  c.header("Content-Type", "text/csv");
  c.header(
    "Content-Disposition",
    `attachment; filename="messages-${new Date().toISOString().split("T")[0]}.csv"`,
  );
  return c.body(csv);
});

/**
 * GET /export/conversation/:contactId - Export conversation for a specific contact
 * Query params: format (csv|json), startDate, endDate
 */
exportRoutes.get("/conversation/:contactId", async (c) => {
  const companyId = c.get("companyId");
  const contactId = c.req.param("contactId");
  const format = (c.req.query("format") as "csv" | "json") || "json";
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  try {
    const conversation = await exportService.exportConversation(
      companyId,
      contactId,
      {
        startDate: startDateStr ? new Date(startDateStr) : undefined,
        endDate: endDateStr ? new Date(endDateStr) : undefined,
      },
    );

    if (format === "json") {
      return c.json({ data: conversation });
    }

    // CSV format - just the messages
    const csv = exportService.toCSV(
      conversation.messages as unknown as Record<string, unknown>[],
    );
    c.header("Content-Type", "text/csv");
    c.header(
      "Content-Disposition",
      `attachment; filename="conversation-${conversation.contact.whatsapp_id}-${new Date().toISOString().split("T")[0]}.csv"`,
    );
    return c.body(csv);
  } catch {
    return c.json({ error: "Contact not found" }, 404);
  }
});

/**
 * POST /export/bulk - Bulk export with custom filters
 * Body: { type: 'contacts' | 'messages', format: 'csv' | 'json', filters: {...} }
 */
exportRoutes.post("/bulk", async (c) => {
  const companyId = c.get("companyId");
  const body = await c.req.json<{
    type: "contacts" | "messages";
    format?: "csv" | "json";
    filters?: {
      tagIds?: string[];
      assignedTo?: string;
      hasCustomName?: boolean;
      contactId?: string;
      startDate?: string;
      endDate?: string;
      messageTypes?: string[];
      limit?: number;
    };
  }>();

  const format = body.format || "csv";
  const filters = body.filters || {};

  let data: unknown[];
  let filename: string;

  if (body.type === "contacts") {
    data = await exportService.exportContacts(companyId, {
      tagIds: filters.tagIds,
      assignedTo: filters.assignedTo,
      hasCustomName: filters.hasCustomName,
    });
    filename = `contacts-${new Date().toISOString().split("T")[0]}`;
  } else {
    data = await exportService.exportMessages(companyId, {
      contactId: filters.contactId,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      messageTypes: filters.messageTypes,
      limit: filters.limit,
    });
    filename = `messages-${new Date().toISOString().split("T")[0]}`;
  }

  if (format === "json") {
    return c.json({ data });
  }

  // CSV format
  const csv = exportService.toCSV(data as Record<string, unknown>[]);
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="${filename}.csv"`);
  return c.body(csv);
});
