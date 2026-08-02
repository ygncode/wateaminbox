import { zValidator } from "@hono/zod-validator";
import { db } from "@wateaminbox/database";
import { now, parseDate, subtractDays, toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { successData } from "../../lib/response.js";
import { resolutionTrendQuerySchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  getCaseResolutionStats,
  getCaseResolutionTrend,
  getOverdueActiveCases,
  getTeamCaseResolutionStats,
} from "../../services/analytics/case-resolution.js";

export const analyticsRoutes = new Hono();

function resolveRange(startDateStr?: string, endDateStr?: string) {
  const endDateDayjs = (endDateStr ? parseDate(endDateStr) : null) ?? now();
  const startDateDayjs =
    (startDateStr ? parseDate(startDateStr) : null) ??
    subtractDays(endDateDayjs, 29).startOf("day");
  return { startDateDayjs, endDateDayjs };
}

/**
 * GET /conversations/stats/resolution - Case-cycle resolution statistics
 * (replaces the old mutable-state resolution stats).
 */
analyticsRoutes.get(
  "/stats/resolution",
  zValidator("query", resolutionTrendQuerySchema),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const { startDate: startDateStr, endDate: endDateStr } =
      c.req.valid("query");
    const { startDateDayjs, endDateDayjs } = resolveRange(
      startDateStr,
      endDateStr,
    );

    const stats = await getCaseResolutionStats(
      companyId,
      startDateDayjs.toDate(),
      endDateDayjs.toDate(),
    );

    return successData(c, stats);
  },
);

/**
 * GET /conversations/stats/resolution-trend - Case resolution trend over time
 */
analyticsRoutes.get(
  "/stats/resolution-trend",
  zValidator("query", resolutionTrendQuerySchema),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const { startDate: startDateStr, endDate: endDateStr } =
      c.req.valid("query");
    const { startDateDayjs, endDateDayjs } = resolveRange(
      startDateStr,
      endDateStr,
    );

    const trend = await getCaseResolutionTrend(
      companyId,
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

/**
 * GET /conversations/stats/resolution-breaches - Currently overdue active
 * cases (resolution-SLA work queue), worst-first.
 */
analyticsRoutes.get("/stats/resolution-breaches", async (c) => {
  const { companyId } = getRouteContext(c);
  const breaches = await getOverdueActiveCases(companyId);
  return successData(c, breaches);
});

/**
 * GET /conversations/stats/resolution-team - Resolution attribution by
 * team member (who resolved what, and how fast).
 */
analyticsRoutes.get(
  "/stats/resolution-team",
  zValidator("query", resolutionTrendQuerySchema),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const { startDate: startDateStr, endDate: endDateStr } =
      c.req.valid("query");
    const { startDateDayjs, endDateDayjs } = resolveRange(
      startDateStr,
      endDateStr,
    );

    const members = await db
      .selectFrom("company_members as cm")
      .innerJoin("users as u", "u.id", "cm.user_id")
      .select(["cm.user_id", "u.email"])
      .where("cm.company_id", "=", companyId)
      .execute();

    const stats = await getTeamCaseResolutionStats(
      companyId,
      startDateDayjs.toDate(),
      endDateDayjs.toDate(),
      members,
    );

    return successData(c, {
      stats,
      meta: {
        startDate: toISOString(startDateDayjs),
        endDate: toISOString(endDateDayjs),
      },
    });
  },
);
