import { Hono } from "hono";
import { createRealtimeConnectionToken } from "../../lib/realtime.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromHeader } from "../../middleware/tenant.js";

export const realtimeRoutes = new Hono();

/**
 * Issue a short-lived Centrifugo connection token. The server-side channel
 * subscriptions are derived exclusively from the authenticated user and their
 * verified current company membership.
 */
realtimeRoutes.post(
  "/token",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const user = c.get("user");
    const companyId = c.get("companyId");
    const token = await createRealtimeConnectionToken(user.id, companyId);
    return c.json({ token });
  },
);

export default realtimeRoutes;
