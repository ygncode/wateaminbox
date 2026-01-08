import { Hono } from "hono"
import { getRouteContext } from "../../middleware/context.js"
import {
  getResolutionStats,
  getResolutionTrend,
} from "../../services/conversation-state.service.js"

export const analyticsRoutes = new Hono()

/**
 * GET /conversations/stats/resolution - Get resolution statistics
 */
analyticsRoutes.get("/stats/resolution", async (c) => {
  const { tenantDb } = getRouteContext(c)

  const stats = await getResolutionStats(tenantDb)

  return c.json({
    data: stats,
  })
})

/**
 * GET /conversations/stats/resolution-trend - Get resolution trend over time
 */
analyticsRoutes.get("/stats/resolution-trend", async (c) => {
  const { tenantDb } = getRouteContext(c)
  const startDateStr = c.req.query("startDate")
  const endDateStr = c.req.query("endDate")

  // Default to last 30 days if not specified
  const endDate = endDateStr ? new Date(endDateStr) : new Date()
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

  const trend = await getResolutionTrend(tenantDb, startDate, endDate)

  return c.json({
    data: trend,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  })
})
