import { toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { successData } from "../lib/response.js";
import {
  extractDateRange,
  extractDayWindow,
  extractOptionalDateRange,
  extractPaginationParams,
  extractSlaThresholdOverride,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { requirePermission, tenantMiddleware } from "../middleware/tenant.js";
import * as analyticsService from "../services/analytics.service.js";
import { PERMISSIONS } from "../services/permission.service.js";

export const analyticsRoutes = new Hono();

// All analytics routes require authentication and tenant context
analyticsRoutes.use("/*", authMiddleware);
analyticsRoutes.use("/*", tenantMiddleware());
analyticsRoutes.use("/*", requirePermission(PERMISSIONS.CAN_VIEW_DASHBOARD));

// Analytics rate limiter: 60 requests per minute per user
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
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/dashboard", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);

  const stats = await analyticsService.getDashboardStats(companyId);

  return successData(c, stats);
});

/**
 * GET /analytics/messages - Get message statistics over time
 * Query params: startDate, endDate
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/messages", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const stats = await analyticsService.getMessageStats(
    companyId,
    startDate,
    endDate,
  );

  return successData(c, {
    stats,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/contacts - Get contact statistics
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/contacts", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);

  const stats = await analyticsService.getContactStats(companyId);

  return successData(c, stats);
});

/**
 * GET /analytics/team - Get team activity statistics
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/team", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);

  const stats = await analyticsService.getTeamActivityStats(companyId);

  return successData(c, stats);
});

/**
 * GET /analytics/message-types - Get message type distribution
 * Query params: startDate, endDate
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/message-types", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractOptionalDateRange(c);

  const stats = await analyticsService.getMessageTypeStats(
    companyId,
    startDate,
    endDate,
  );

  return successData(c, stats);
});

/**
 * GET /analytics/hourly - Get hourly message distribution
 * Query params: days (default 30)
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/hourly", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const days = extractDayWindow(c);

  const stats = await analyticsService.getHourlyMessageStats(companyId, days);

  return successData(c, stats);
});

/**
 * GET /analytics/response-time - Get response time statistics
 *
 * Query params: startDate, endDate, slaThreshold (optional minutes
 * override). Normally `slaThreshold` is omitted: each response episode is
 * then measured against whichever SLA policy version (target + business
 * calendar) was active when it began - the persisted, historical, default
 * behavior. If provided, `slaThreshold` replaces only the target duration
 * used for compliance decisions; each episode's own historical calendar is
 * still always used for the business-time calculation itself.
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/response-time", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);
  const slaTargetOverrideMinutes = extractSlaThresholdOverride(c);

  const stats = await analyticsService.getResponseTimeStats(
    companyId,
    startDate,
    endDate,
    slaTargetOverrideMinutes,
  );

  return successData(c, {
    ...stats,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaTargetOverrideMinutes: slaTargetOverrideMinutes ?? null,
    },
  });
});

/**
 * GET /analytics/response-time/trend - Get response time trend over time
 * Query params: startDate, endDate, slaThreshold (optional minutes override)
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/response-time/trend", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);
  const slaTargetOverrideMinutes = extractSlaThresholdOverride(c);

  const trend = await analyticsService.getResponseTimeTrend(
    companyId,
    startDate,
    endDate,
    slaTargetOverrideMinutes,
  );

  return successData(c, {
    trend,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaTargetOverrideMinutes: slaTargetOverrideMinutes ?? null,
    },
  });
});

/**
 * GET /analytics/response-time/team - Get response time stats by team member
 * Query params: startDate, endDate, slaThreshold (optional minutes override)
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/response-time/team", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const slaTargetOverrideMinutes = extractSlaThresholdOverride(c);

  const { startDate, endDate } = extractDateRange(c, 30);

  const stats = await analyticsService.getTeamResponseTimeStats(
    companyId,
    startDate,
    endDate,
    slaTargetOverrideMinutes,
  );

  return successData(c, {
    stats,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaTargetOverrideMinutes: slaTargetOverrideMinutes ?? null,
    },
  });
});

/**
 * GET /analytics/contacts/trend - Get new contacts trend over time
 * Query params: startDate, endDate
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/contacts/trend", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const trend = await analyticsService.getNewContactsTrend(
    companyId,
    startDate,
    endDate,
  );

  return successData(c, {
    trend,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/engagement - Get customer engagement metrics
 * Query params: startDate, endDate
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/engagement", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const metrics = await analyticsService.getEngagementMetrics(
    companyId,
    startDate,
    endDate,
  );

  return successData(c, {
    ...metrics,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/engagement/trend - Get engagement trend over time
 * Query params: startDate, endDate
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/engagement/trend", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 30);

  const trend = await analyticsService.getEngagementTrend(
    companyId,
    startDate,
    endDate,
  );

  return successData(c, {
    trend,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
    },
  });
});

/**
 * GET /analytics/sla-breaches - Get conversations that exceeded SLA
 * Query params: startDate, endDate, slaThreshold (optional minutes override), limit (default 50)
 * Rate limit: 60 requests per minute per user
 */
analyticsRoutes.get("/sla-breaches", analyticsRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);
  const { startDate, endDate } = extractDateRange(c, 7);
  const slaTargetOverrideMinutes = extractSlaThresholdOverride(c);
  const { limit } = extractPaginationParams(c);

  const breaches = await analyticsService.getSlaBreaches(
    companyId,
    startDate,
    endDate,
    slaTargetOverrideMinutes,
    limit,
  );

  return successData(c, {
    breaches,
    meta: {
      startDate: toISOString(startDate),
      endDate: toISOString(endDate),
      slaTargetOverrideMinutes: slaTargetOverrideMinutes ?? null,
    },
  });
});
