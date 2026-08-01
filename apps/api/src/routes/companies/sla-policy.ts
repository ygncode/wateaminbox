/**
 * Company SLA policy routes
 *
 * A dedicated, authorized resource (rather than folding into the general
 * company-identity PATCH) since SLA policies are versioned/immutable and
 * have their own validation shape (weekly calendar + exceptions).
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { successData } from "../../lib/response.js";
import { createSlaPolicySchema } from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam } from "../../middleware/tenant.js";
import * as slaPolicyService from "../../services/sla-policy/policy.service.js";

export const slaPolicyRoutes = new Hono();

/**
 * GET /:id/sla-policy - Get the SLA policy currently in effect.
 * Any member can view it (read-only summary is fine for non-admins).
 */
slaPolicyRoutes.get(
  "/:id/sla-policy",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    const companyId = c.get("companyId");
    const policy = await slaPolicyService.getCurrentSlaPolicy(companyId);
    return successData(c, policy);
  },
);

/**
 * GET /:id/sla-policy/history - Full, immutable version history.
 * Any member can view it.
 */
slaPolicyRoutes.get(
  "/:id/sla-policy/history",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    const companyId = c.get("companyId");
    const history = await slaPolicyService.listSlaPolicyHistory(companyId);
    return successData(c, history);
  },
);

/**
 * POST /:id/sla-policy - Create a new (immediately-active) SLA policy
 * version. Admin/owner only. Never overwrites a prior version.
 */
slaPolicyRoutes.post(
  "/:id/sla-policy",
  authMiddleware,
  tenantFromParam("id", "admin"),
  zValidator("json", createSlaPolicySchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const input = c.req.valid("json");
    const policy = await slaPolicyService.createSlaPolicy(
      companyId,
      input,
      user.id,
    );
    return successData(c, policy);
  },
);
