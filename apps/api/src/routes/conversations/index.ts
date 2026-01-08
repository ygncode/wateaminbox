import { Hono } from "hono"
import { authMiddleware } from "../../middleware/auth.js"
import { tenantMiddleware } from "../../middleware/tenant.js"
import { analyticsRoutes } from "./analytics.js"
import { messageRoutes } from "./messages.js"
import { stateRoutes } from "./state.js"

export const conversationRoutes = new Hono()

// All conversation routes require authentication and tenant context
conversationRoutes.use("/*", authMiddleware)
conversationRoutes.use("/*", tenantMiddleware())

// Mount analytics routes first (more specific path matching)
conversationRoutes.route("/", analyticsRoutes)

// Mount state and message routes
conversationRoutes.route("/", stateRoutes)
conversationRoutes.route("/", messageRoutes)
