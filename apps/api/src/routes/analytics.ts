import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as analyticsService from "../services/analytics.service.js";

export const analyticsRoutes = new Hono();

// All analytics routes require authentication and tenant context
analyticsRoutes.use("/*", authMiddleware);
analyticsRoutes.use("/*", tenantMiddleware());

/**
 * GET /analytics/dashboard - Get dashboard overview stats
 */
analyticsRoutes.get("/dashboard", async (c) => {
  const companyId = c.get("companyId");

  const stats = await analyticsService.getDashboardStats(companyId);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/messages - Get message statistics over time
 * Query params: startDate, endDate
 */
analyticsRoutes.get("/messages", async (c) => {
  const companyId = c.get("companyId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  // Default to last 30 days
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const stats = await analyticsService.getMessageStats(
    companyId,
    startDate,
    endDate,
  );

  return c.json({
    data: stats,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  });
});

/**
 * GET /analytics/contacts - Get contact statistics
 */
analyticsRoutes.get("/contacts", async (c) => {
  const companyId = c.get("companyId");

  const stats = await analyticsService.getContactStats(companyId);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/team - Get team activity statistics
 */
analyticsRoutes.get("/team", async (c) => {
  const companyId = c.get("companyId");
  const role = c.get("companyRole");

  // Only admins and owners can view team stats
  if (role === "member") {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const stats = await analyticsService.getTeamActivityStats(companyId);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/message-types - Get message type distribution
 * Query params: startDate, endDate
 */
analyticsRoutes.get("/message-types", async (c) => {
  const companyId = c.get("companyId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  const startDate = startDateStr ? new Date(startDateStr) : undefined;
  const endDate = endDateStr ? new Date(endDateStr) : undefined;

  const stats = await analyticsService.getMessageTypeStats(
    companyId,
    startDate,
    endDate,
  );

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/hourly - Get hourly message distribution
 * Query params: days (default 30)
 */
analyticsRoutes.get("/hourly", async (c) => {
  const companyId = c.get("companyId");
  const days = parseInt(c.req.query("days") || "30", 10);

  const stats = await analyticsService.getHourlyMessageStats(companyId, days);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/response-time - Get response time statistics
 * Query params: startDate, endDate, slaThreshold (minutes, default 60)
 */
analyticsRoutes.get("/response-time", async (c) => {
  const companyId = c.get("companyId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);

  // Default to last 30 days
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const stats = await analyticsService.getResponseTimeStats(
    companyId,
    startDate,
    endDate,
    slaThreshold,
  );

  return c.json({
    data: stats,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      slaThresholdMinutes: slaThreshold,
    },
  });
});

/**
 * GET /analytics/response-time/trend - Get response time trend over time
 * Query params: startDate, endDate, slaThreshold (minutes, default 60)
 */
analyticsRoutes.get("/response-time/trend", async (c) => {
  const companyId = c.get("companyId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);

  // Default to last 30 days
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const trend = await analyticsService.getResponseTimeTrend(
    companyId,
    startDate,
    endDate,
    slaThreshold,
  );

  return c.json({
    data: trend,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      slaThresholdMinutes: slaThreshold,
    },
  });
});

/**
 * GET /analytics/response-time/team - Get response time stats by team member
 * Query params: startDate, endDate, slaThreshold (minutes, default 60)
 */
analyticsRoutes.get("/response-time/team", async (c) => {
  const companyId = c.get("companyId");
  const role = c.get("companyRole");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);

  // Only admins and owners can view team stats
  if (role === "member") {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  // Default to last 30 days
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const stats = await analyticsService.getTeamResponseTimeStats(
    companyId,
    startDate,
    endDate,
    slaThreshold,
  );

  return c.json({
    data: stats,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      slaThresholdMinutes: slaThreshold,
    },
  });
});

/**
 * GET /analytics/sla-breaches - Get conversations that exceeded SLA
 * Query params: startDate, endDate, slaThreshold (minutes, default 60), limit (default 50)
 */
analyticsRoutes.get("/sla-breaches", async (c) => {
  const companyId = c.get("companyId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);
  const limit = parseInt(c.req.query("limit") || "50", 10);

  // Default to last 7 days
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const breaches = await analyticsService.getSlaBreaches(
    companyId,
    startDate,
    endDate,
    slaThreshold,
    limit,
  );

  return c.json({
    data: breaches,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      slaThresholdMinutes: slaThreshold,
    },
  });
});
