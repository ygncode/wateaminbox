import { zValidator } from "../../lib/validator.js";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { assignContactSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { resolveWorkflowIdentity } from "../../services/channel-workflow.service.js";
import {
  assignContactToUser,
  assignConversationToUser,
  getCurrentAssignment,
  getCurrentConversationAssignment,
  unassignContact,
  unassignConversation,
} from "../../services/contact.service.js";

export const conversationAssignmentRoutes = new Hono();

conversationAssignmentRoutes.get("/:id/assignment", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  if (!identity) return notFound(c, "Conversation");
  const assignment = identity.contactId
    ? await getCurrentAssignment(tenantDb, identity.contactId)
    : await getCurrentConversationAssignment(
        tenantDb,
        identity.conversationId!,
      );
  return successData(c, assignment ?? null);
});

conversationAssignmentRoutes.post(
  "/:id/assign",
  zValidator("json", assignContactSchema),
  async (c) => {
    const { tenantDb, user } = getRouteContext(c);
    const identity = await resolveWorkflowIdentity(
      tenantDb,
      c.req.param("id")!,
    );
    if (!identity) return notFound(c, "Conversation");
    const targetUserId = c.req.valid("json").targetUserId ?? user.id;
    if (identity.contactId) {
      const assignment = await assignContactToUser(
        tenantDb,
        identity.contactId,
        targetUserId,
        user.id,
      );
      return successData(c, assignment, 201);
    }
    await assignConversationToUser(
      tenantDb,
      identity.conversationId!,
      targetUserId,
      user.id,
    );
    const assignment = await getCurrentConversationAssignment(
      tenantDb,
      identity.conversationId!,
    );
    return successData(c, assignment, 201);
  },
);

conversationAssignmentRoutes.delete("/:id/assign", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  if (!identity) return notFound(c, "Conversation");
  if (identity.contactId) {
    await unassignContact(tenantDb, identity.contactId);
  } else {
    await unassignConversation(tenantDb, identity.conversationId!);
  }
  return successData(c, { unassigned: true });
});
