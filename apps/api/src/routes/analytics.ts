import { toISOString } from "@whatsapp-web/shared";
import { Hono } from "hono";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import {
  extractDateRange,
  extractOptionalDateRange,
  extractPaginationParams,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as analyticsService from "../services/analytics.service.js";

export const analyticsRoutes = new Hono();

// All analytics routes require authentication and tenant context
analyticsRoutes.use("/*", authMiddleware);
analyticsRoutes.use("/*", tenantMiddleware());

// Analytics rate limiter: 20 requests per minute per user
// Analytics queries can be resource-intensive with aggregations
const analyticsRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.analytics,
    keyStrategy: "user",
    keyPrefix: "resource-analytics",
  },
  rateLimitConfig.enabled,
);

/**
 * GET /analytics/dashboard - Get dashboard overview stats
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/dashboard", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);

  const stats = await analyticsService.getDashboardStats(companyId);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/messages - Get message statistics over time
 * Query params: startDate, endDate
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/messages", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const stats = await analyticsService.getMessageStats(
    companyId,
    startDate,
    endDate,
  );

  return c.json({
    data: stats,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/contacts - Get contact statistics
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/contacts", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);

  const stats = await analyticsService.getContactStats(companyId);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/team - Get team activity statistics
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/team", analyticsRateLimiter, async (c) => {
  const { companyId, role } = getRouteContext(c);

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
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/message-types", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractOptionalDateRange(c);

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
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/hourly", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const days = parseInt(c.req.query("days") || "30", 10);

  const stats = await analyticsService.getHourlyMessageStats(companyId, days);

  return c.json({
    data: stats,
  });
});

/**
 * GET /analytics/response-time - Get response time statistics
 * Query params: startDate, endDate, slaThreshold (minutes, default 60)
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/response-time", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);

  const stats = await analyticsService.getResponseTimeStats(
    companyId,
    startDate,
    endDate,
    slaThreshold,
  );

  return c.json({
    data: stats,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaThresholdMinutes: slaThreshold,
    },
  });
});

/**
 * GET /analytics/response-time/trend - Get response time trend over time
 * Query params: startDate, endDate, slaThreshold (minutes, default 60)
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/response-time/trend", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);

  const trend = await analyticsService.getResponseTimeTrend(
    companyId,
    startDate,
    endDate,
    slaThreshold,
  );

  return c.json({
    data: trend,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaThresholdMinutes: slaThreshold,
    },
  });
});

/**
 * GET /analytics/response-time/team - Get response time stats by team member
 * Query params: startDate, endDate, slaThreshold (minutes, default 60)
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/response-time/team", analyticsRateLimiter, async (c) => {
  const { companyId, role } = getRouteContext(c);
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);

  // Only admins and owners can view team stats
  if (role === "member") {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const { startDate, endDate } = extractDateRange(c, 30);

  const stats = await analyticsService.getTeamResponseTimeStats(
    companyId,
    startDate,
    endDate,
    slaThreshold,
  );

  return c.json({
    data: stats,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaThresholdMinutes: slaThreshold,
    },
  });
});

/**
 * GET /analytics/contacts/trend - Get new contacts trend over time
 * Query params: startDate, endDate
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/contacts/trend", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const trend = await analyticsService.getNewContactsTrend(
    companyId,
    startDate,
    endDate,
  );

  return c.json({
    data: trend,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/engagement - Get customer engagement metrics
 * Query params: startDate, endDate
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/engagement", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const metrics = await analyticsService.getEngagementMetrics(
    companyId,
    startDate,
    endDate,
  );

  return c.json({
    data: metrics,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/engagement/trend - Get engagement trend over time
 * Query params: startDate, endDate
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/engagement/trend", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const trend = await analyticsService.getEngagementTrend(
    companyId,
    startDate,
    endDate,
  );

  return c.json({
    data: trend,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/sla-breaches - Get conversations that exceeded SLA
 * Query params: startDate, endDate, slaThreshold (minutes, default 60), limit (default 50)
 * Rate limit: 20 requests per minute per user
 */
analyticsRoutes.get("/sla-breaches", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 7);
  const slaThreshold = parseInt(c.req.query("slaThreshold") || "60", 10);
  const { limit } = extractPaginationParams(c);

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
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaThresholdMinutes: slaThreshold,
    },
  });
});
