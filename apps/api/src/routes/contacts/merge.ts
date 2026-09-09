import { zValidator } from "@hono/zod-validator";
import { getContactDisplayName } from "@wateaminbox/shared";
import { Hono } from "hono";
import { z } from "zod";
import { successData } from "../../lib/response.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { getChannelSpineWorkspaceAuthority } from "../../services/channel-spine-authority.service.js";
import { isChannelSpineTenantReady } from "../../services/channel-spine-readiness.service.js";
import { mergeContacts } from "../../services/contact-merge.service.js";
import * as meilisearchService from "../../services/meilisearch.service.js";

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
  // The RFC blocks executing merges until inbox workflow ownership is
  // conversation-scoped for this workspace. Fail closed on missing, invalid,
  // or unavailable flags rather than merging against legacy contact-scoped
  // workflow rows.
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  if (
    authority.writeAuthority !== "neutral" ||
    !(await isChannelSpineTenantReady(tenantDb))
  ) {
    return c.json(
      { error: "Contact merge is not enabled for this workspace" },
      409,
    );
  }
  const result = await mergeContacts(tenantDb, {
    sourceContactId: c.req.valid("json").sourceContactId,
    targetContactId: c.req.param("id")!,
    actorUserId: user.id,
    reason: c.req.valid("json").reason,
  });
  await refreshMergeSearchProjection(tenantDb, companyId, result);
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.merged",
    entityType: "contact",
    entityId: c.req.param("id")!,
    details: { ...result },
    ipAddress: getClientIp(c),
  });
  return successData(c, result);
});

/**
 * The merged-away customer must stop being a separate search hit, and the
 * surviving customer must reflect any endpoint/profile evidence it absorbed.
 * Search is best-effort: a failure here must not undo a committed merge.
 */
async function refreshMergeSearchProjection(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  companyId: string,
  result: { sourceContactId: string; targetContactId: string },
): Promise<void> {
  await meilisearchService.deleteContact(companyId, result.sourceContactId);
  const target = await tenantDb
    .selectFrom("contacts")
    .select([
      "id",
      "jid",
      "phone_number",
      "push_name",
      "username",
      "custom_name",
      "is_group",
      "notes_shared",
    ])
    .where("id", "=", result.targetContactId)
    .executeTakeFirst();
  if (!target) return;
  await meilisearchService.indexContact(companyId, {
    id: target.id,
    companyId,
    jid: target.jid,
    phoneNumber: target.phone_number,
    pushName: target.push_name,
    username: target.username,
    customName: target.custom_name,
    displayName: getContactDisplayName(target),
    isGroup: target.is_group,
    notesShared: target.notes_shared,
  });
}
