import { dayjs, toDbDate, toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { transformAuditLogs } from "../lib/data-transformers.js";
import { successData, successPaginated } from "../lib/response.js";
import {
  createPaginationMeta,
  extractPaginationParams,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { requirePermission, tenantMiddleware } from "../middleware/tenant.js";
import * as auditService from "../services/audit.service.js";
import { createCSVHeader, createCSVRow } from "../services/export/csv.js";
import { PERMISSIONS } from "../services/permission.service.js";

export const auditRoutes = new Hono();

function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/(token|password|secret|authorization|access.?key)/i.test(key),
        )
        .map(([key, entry]) => [key, sanitizeAuditDetails(entry)]),
    );
  }
  return value;
}

/**
 * Column order for the audit CSV export. Exported so tests can pin the shape
 * independently of the route handler.
 */
export const AUDIT_EXPORT_COLUMNS = [
  "ID",
  "Actor",
  "Actor Email",
  "Action",
  "Entity Type",
  "Entity ID",
  "Details",
  "IP Address",
  "Created At",
];

/**
 * Build the audit-log CSV body.
 *
 * Routes every cell through the shared CSV helpers (`createCSVHeader` /
 * `createCSVRow`), which apply `neutralizeFormula` so an attacker-controlled
 * Actor name starting with `=`, `+`, `-`, or `@` is emitted as inert text
 * instead of a spreadsheet formula. This keeps the audit export on the same
 * neutralization convention as the other data exports.
 *
 * Exported for unit testing without a database or HTTP layer.
 */
export function buildAuditExportCSV(logs: auditService.AuditLog[]): string {
  const rows = logs.map((log) => ({
    ID: log.id,
    Actor: log.actor?.name || "System",
    "Actor Email": log.actor?.email || "",
    Action: log.action,
    "Entity Type": log.entityType || "",
    "Entity ID": log.entityId || "",
    Details: log.details
      ? JSON.stringify(sanitizeAuditDetails(log.details))
      : "",
    "IP Address": log.ipAddress || "",
    "Created At": toISOString(log.createdAt),
  }));

  return [
    createCSVHeader(AUDIT_EXPORT_COLUMNS),
    ...rows.map((row) => createCSVRow(row, AUDIT_EXPORT_COLUMNS)),
  ].join("\n");
}

// All audit routes require authentication and tenant context
auditRoutes.use("/*", authMiddleware);
auditRoutes.use("/*", tenantMiddleware());
auditRoutes.use("/*", requirePermission(PERMISSIONS.CAN_VIEW_AUDIT));

/**
 * GET /audit - Get audit logs with optional filters
 * Query params: userId, action, entityType, entityId, startDate, endDate, limit, offset
 */
auditRoutes.get("/", async (c) => {
  const { companyId } = getRouteContext(c);

  const userId = c.req.query("userId");
  const action = c.req.query("action") as auditService.AuditAction | undefined;
  const entityType = c.req.query("entityType");
  const entityId = c.req.query("entityId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const { limit, offset } = extractPaginationParams(c);

  const result = await auditService.getAuditLogs({
    companyId,
    userId: userId || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    entityId: entityId || undefined,
    startDate: startDateStr ? toDbDate(startDateStr) : undefined,
    endDate: endDateStr ? dayjs(endDateStr).endOf("day").toDate() : undefined,
    limit,
    offset,
  });

  return successPaginated(
    c,
    transformAuditLogs(result.logs).map((log) => ({
      ...log,
      details: sanitizeAuditDetails(log.details) as Record<
        string,
        unknown
      > | null,
    })),
    createPaginationMeta(result.total, result.logs.length, {
      limit,
      offset,
    }),
  );
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
    "contact.blocked",
    "contact.unblocked",
    "contact.note.created",
    "contact.note.updated",
    "contact.note.deleted",
    "message.sent",
    "message.deleted",
    "bulk_job.created",
    "bulk_job.rescheduled",
    "bulk_job.canceled",
    "bulk_job.completed",
    "tag.created",
    "tag.deleted",
    "company.updated",
    "conversation.resolved",
    "conversation.reopened",
  ];

  return successData(
    c,
    actions.map((action) => ({
      value: action,
      label: action
        .split(".")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" - "),
    })),
  );
});

/** GET /audit/actors - Actors available to audit filters. */
auditRoutes.get("/actors", async (c) => {
  const { companyId } = getRouteContext(c);
  return successData(c, await auditService.getAuditActors(companyId));
});

/**
 * GET /audit/export - Export audit logs as CSV
 */
auditRoutes.get(
  "/export",
  requirePermission(PERMISSIONS.CAN_EXPORT),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const action = c.req.query("action") as
      | auditService.AuditAction
      | undefined;
    const userId = c.req.query("userId");
    const entityType = c.req.query("entityType");
    const startDateStr = c.req.query("startDate");
    const endDateStr = c.req.query("endDate");

    const result = await auditService.getAuditLogs({
      companyId,
      userId: userId || undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      startDate: startDateStr ? toDbDate(startDateStr) : undefined,
      endDate: endDateStr ? dayjs(endDateStr).endOf("day").toDate() : undefined,
      limit: 10000,
      offset: 0,
    });

    const csv = buildAuditExportCSV(result.logs);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-logs-${toISOString(toDbDate()).split("T")[0]}.csv"`,
      },
    });
  },
);
