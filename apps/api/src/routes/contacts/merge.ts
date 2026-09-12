import { zValidator } from "../../lib/validator.js";
import { getContactDisplayName } from "@wateaminbox/shared";
import { Hono } from "hono";
import { z } from "zod";
import { successData } from "../../lib/response.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { resolveWorkflowContactId } from "../../services/channel-workflow.service.js";
import {
  isContactMergeEnabled,
  listMergeHistory,
  mergeContacts,
  resolveCanonicalContactId,
  suggestContactMerges,
  unmergeContacts,
} from "../../services/contact-merge.service.js";
import * as meilisearchService from "../../services/meilisearch.service.js";

const mergeSchema = z.object({
  sourceContactId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

const unmergeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const mergeRoutes = new Hono();

/**
 * Merge *suggestions* are read-only evidence and are available regardless of
 * the merge execution gate: an operator may review candidates long before the
 * workspace is allowed to act on them.
 */
mergeRoutes.get("/:id/merge-suggestions", async (c) => {
  const { tenantDb, role } = getRouteContext(c);
  // These routes are mounted ahead of the contact-visibility middleware, so
  // they carry their own gate. Suggestions name contacts a member may not be
  // allowed to see, so they stay with the roles that can act on them.
  if (role === "member") {
    return c.json({ error: "Forbidden" }, 403);
  }
  return successData(
    c,
    await suggestContactMerges(tenantDb, c.req.param("id")!),
  );
});

mergeRoutes.post("/:id/merge", zValidator("json", mergeSchema), async (c) => {
  const { tenantDb, user, companyId, role } = getRouteContext(c);
  if (role === "member") {
    return c.json({ error: "Forbidden" }, 403);
  }
  // The RFC blocks executing merges until inbox workflow ownership is
  // conversation-scoped for this workspace. Fail closed on missing, invalid,
  // or unavailable flags rather than merging against legacy contact-scoped
  // workflow rows.
  if (!(await isContactMergeEnabled(tenantDb, companyId))) {
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
 * What was merged into this customer.
 *
 * Read-only history, and outside the execution gate for the same reason
 * suggestions are: a workspace that may no longer merge must still be able to
 * see what it already did.
 */
mergeRoutes.get("/:id/merge-history", async (c) => {
  const { tenantDb, role } = getRouteContext(c);
  if (role === "member") {
    return c.json({ error: "Forbidden" }, 403);
  }
  // The profile panel is opened with whatever id the chat list used, which is
  // the conversation for a neutral thread, and history is recorded against the
  // surviving customer.
  const requestedId = c.req.param("id")!;
  const workflowContactId =
    (await resolveWorkflowContactId(tenantDb, requestedId)) ?? requestedId;
  const contactId =
    (await resolveCanonicalContactId(tenantDb, workflowContactId)) ??
    workflowContactId;
  return successData(c, {
    merges: await listMergeHistory(tenantDb, contactId),
  });
});

/**
 * Correct a merge. Addressed by merge event rather than by contact, because
 * the correction has to name the specific decision being undone: a customer
 * may have been merged more than once, and only the merge currently in effect
 * can be reversed.
 */
mergeRoutes.post(
  "/merges/:mergeEventId/unmerge",
  zValidator("json", unmergeSchema),
  async (c) => {
    const { tenantDb, user, companyId, role } = getRouteContext(c);
    if (role === "member") {
      return c.json({ error: "Forbidden" }, 403);
    }
    // Same gate as executing a merge: a workspace that may not merge must not
    // be able to reach into merge history either.
    if (!(await isContactMergeEnabled(tenantDb, companyId))) {
      return c.json(
        { error: "Contact merge is not enabled for this workspace" },
        409,
      );
    }
    const result = await unmergeContacts(tenantDb, {
      mergeEventId: c.req.param("mergeEventId")!,
      actorUserId: user.id,
      reason: c.req.valid("json").reason,
    });
    // The revived customer becomes its own search hit again, and the survivor
    // must stop advertising the endpoints it just gave back.
    await refreshMergeSearchProjection(tenantDb, companyId, {
      sourceContactId: result.targetContactId,
      targetContactId: result.sourceContactId,
    });
    await refreshMergeSearchProjection(tenantDb, companyId, {
      sourceContactId: result.sourceContactId,
      targetContactId: result.targetContactId,
    });
    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.unmerged",
      entityType: "contact",
      entityId: result.sourceContactId,
      details: { ...result },
      ipAddress: getClientIp(c),
    });
    return successData(c, result);
  },
);

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
