import { Hono } from "hono";
import { createLogger, formatError } from "../lib/logger.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { authMiddleware } from "../middleware/auth.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { requirePermission, tenantMiddleware } from "../middleware/tenant.js";
import * as exportService from "../services/export.service.js";
import { PERMISSIONS } from "../services/permission.service.js";

const logger = createLogger("ExportRoutes");

export const exportRoutes = new Hono();

// All export routes require authentication, tenant context, and can_export permission
exportRoutes.use("/*", authMiddleware);
exportRoutes.use("/*", tenantMiddleware());
exportRoutes.use("/*", requirePermission(PERMISSIONS.CAN_EXPORT));

// Export rate limiter: 10 requests per hour per user
// Export operations are resource-intensive, so we use a strict limit
const exportRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.export,
    keyStrategy: "user",
    keyPrefix: "resource-export",
  },
  rateLimitConfig.enabled,
);

/**
 * GET /export/contacts - Export contacts
 * Query params: format (csv|json), tagIds, assignedTo, hasCustomName
 * Rate limit: 10 requests per hour per user
 */
exportRoutes.get("/contacts", exportRateLimiter, async (c) => {
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
 * Query params: format (csv|json), contactId, startDate, endDate, messageTypes, limit, offset
 * Rate limit: 10 requests per hour per user
 */
exportRoutes.get("/messages", exportRateLimiter, async (c) => {
  const companyId = c.get("companyId");
  const format = (c.req.query("format") as "csv" | "json") || "csv";
  const contactId = c.req.query("contactId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const messageTypes = c.req.query("messageTypes")?.split(",").filter(Boolean);
  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");

  const messages = await exportService.exportMessages(companyId, {
    contactId: contactId || undefined,
    startDate: startDateStr ? new Date(startDateStr) : undefined,
    endDate: endDateStr ? new Date(endDateStr) : undefined,
    messageTypes,
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
    offset: offsetStr ? parseInt(offsetStr, 10) : undefined,
  });

  if (format === "json") {
    return c.json({
      data: messages,
      pagination: {
        count: messages.length,
        limit: limitStr ? parseInt(limitStr, 10) : null,
        offset: offsetStr ? parseInt(offsetStr, 10) : 0,
      },
    });
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
 * Rate limit: 10 requests per hour per user
 */
exportRoutes.get("/conversation/:contactId", exportRateLimiter, async (c) => {
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
 * GET /export/full - Full backup as ZIP file
 * Query params: startDate, endDate
 * Rate limit: 10 requests per hour per user
 */
exportRoutes.get("/full", exportRateLimiter, async (c) => {
  const companyId = c.get("companyId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  try {
    const zipData = await exportService.exportFullBackup(companyId, {
      startDate: startDateStr ? new Date(startDateStr) : undefined,
      endDate: endDateStr ? new Date(endDateStr) : undefined,
    });

    const filename = `whatsapp-backup-${new Date().toISOString().split("T")[0]}.zip`;

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Content-Length", String(zipData.length));

    // Return as Buffer for proper binary response
    return c.body(Buffer.from(zipData));
  } catch (error) {
    logger.error({ err: formatError(error) }, "Full backup export error");
    return c.json({ error: "Failed to create backup" }, 500);
  }
});

/**
 * POST /export/bulk - Bulk export with custom filters
 * Body: { type: 'contacts' | 'messages', format: 'csv' | 'json', filters: {...} }
 * Rate limit: 10 requests per hour per user
 */
exportRoutes.post("/bulk", exportRateLimiter, async (c) => {
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
      offset?: number;
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
      offset: filters.offset,
    });
    filename = `messages-${new Date().toISOString().split("T")[0]}`;
  }

  if (format === "json") {
    return c.json({
      data,
      pagination:
        body.type === "messages"
          ? {
              count: data.length,
              limit: filters.limit || null,
              offset: filters.offset || 0,
            }
          : undefined,
    });
  }

  // CSV format
  const csv = exportService.toCSV(data as Record<string, unknown>[]);
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="${filename}.csv"`);
  return c.body(csv);
});
