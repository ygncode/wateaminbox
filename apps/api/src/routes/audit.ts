import { toDbDate, toISOString } from "@whatsapp-web/shared";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as auditService from "../services/audit.service.js";

export const auditRoutes = new Hono();

// All audit routes require authentication and tenant context
auditRoutes.use("/*", authMiddleware);
auditRoutes.use("/*", tenantMiddleware());

/**
 * GET /audit - Get audit logs with optional filters
 * Query params: userId, action, entityType, entityId, startDate, endDate, limit, offset
 */
auditRoutes.get("/", async (c) => {
  const { companyId, role } = getRouteContext(c);

  // Only admins and owners can view audit logs
  if (role === "member") {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const userId = c.req.query("userId");
  const action = c.req.query("action") as auditService.AuditAction | undefined;
  const entityType = c.req.query("entityType");
  const entityId = c.req.query("entityId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const result = await auditService.getAuditLogs({
    companyId,
    userId: userId || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    entityId: entityId || undefined,
    startDate: startDateStr ? toDbDate(startDateStr) : undefined,
    endDate: endDateStr ? toDbDate(endDateStr) : undefined,
    limit,
    offset,
  });

  return c.json({
    data: result.logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.details,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt,
    })),
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.logs.length < result.total,
    },
  });
});

/**
 * GET /audit/actions - Get list of available action types
 */
auditRoutes.get("/actions", async (c) => {
  const actions: auditService.AuditAction[] = [
    "user.login",
    "user.logout",
    "invitation.sent",
    "invitation.accepted",
    "invitation.cancelled",
    "invitation.resent",
    "member.role_changed",
    "member.removed",
    "contact.created",
    "contact.updated",
    "contact.assigned",
    "contact.unassigned",
    "message.sent",
    "message.deleted",
    "tag.created",
    "tag.deleted",
    "company.updated",
  ];

  return c.json({
    data: actions.map((action) => ({
      value: action,
      label: action
        .split(".")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" - "),
    })),
  });
});

/**
 * GET /audit/export - Export audit logs as CSV
 */
auditRoutes.get("/export", async (c) => {
  const { companyId, role } = getRouteContext(c);

  // Only admins and owners can export audit logs
  if (role === "member") {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  const result = await auditService.getAuditLogs({
    companyId,
    startDate: startDateStr ? toDbDate(startDateStr) : undefined,
    endDate: endDateStr ? toDbDate(endDateStr) : undefined,
    limit: 10000, // Max export limit
    offset: 0,
  });

  // Generate CSV
  const headers = [
    "ID",
    "User ID",
    "Action",
    "Entity Type",
    "Entity ID",
    "Details",
    "IP Address",
    "Created At",
  ];
  const rows = result.logs.map((log) => [
    log.id,
    log.userId || "",
    log.action,
    log.entityType || "",
    log.entityId || "",
    log.details ? JSON.stringify(log.details) : "",
    log.ipAddress || "",
    toISOString(log.createdAt),
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="audit-logs-${toISOString(toDbDate()).split("T")[0]}.csv"`,
    },
  });
});
