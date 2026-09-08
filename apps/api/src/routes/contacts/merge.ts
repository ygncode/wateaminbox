import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { successData } from "../../lib/response.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { mergeContacts } from "../../services/contact-merge.service.js";

const mergeSchema = z.object({
  sourceContactId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const mergeRoutes = new Hono();

mergeRoutes.post("/:id/merge", zValidator("json", mergeSchema), async (c) => {
  const { tenantDb, user, companyId, role } = getRouteContext(c);
  if (role === "member") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const result = await mergeContacts(tenantDb, {
    sourceContactId: c.req.valid("json").sourceContactId,
    targetContactId: c.req.param("id")!,
    actorUserId: user.id,
    reason: c.req.valid("json").reason,
  });
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.merged",
    entityType: "contact",
    entityId: c.req.param("id")!,
    details: result,
    ipAddress: getClientIp(c),
  });
  return successData(c, result);
});
