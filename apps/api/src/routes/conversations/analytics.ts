import { zValidator } from "@hono/zod-validator";
import { now, parseDate, subtractDays, toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { successData } from "../../lib/response.js";
import { resolutionTrendQuerySchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  getResolutionStats,
  getResolutionTrend,
} from "../../services/conversation-state.service.js";

export const analyticsRoutes = new Hono();

/**
 * GET /conversations/stats/resolution - Get resolution statistics
 */
analyticsRoutes.get("/stats/resolution", async (c) => {
  const { tenantDb } = getRouteContext(c);

  const stats = await getResolutionStats(tenantDb);

  return successData(c, stats);
});

/**
 * GET /conversations/stats/resolution-trend - Get resolution trend over time
 */
analyticsRoutes.get(
  "/stats/resolution-trend",
  zValidator("query", resolutionTrendQuerySchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const { startDate: startDateStr, endDate: endDateStr } =
      c.req.valid("query");

    // Default to last 30 days if not specified
    const endDateDayjs = (endDateStr ? parseDate(endDateStr) : null) ?? now();
    const startDateDayjs =
      (startDateStr ? parseDate(startDateStr) : null) ??
      subtractDays(endDateDayjs, 30);

    const trend = await getResolutionTrend(
      tenantDb,
      startDateDayjs.toDate(),
      endDateDayjs.toDate(),
    );

    return successData(c, {
      trend,
      meta: {
        startDate: toISOString(startDateDayjs),
        endDate: toISOString(endDateDayjs),
      },
    });
  },
);
