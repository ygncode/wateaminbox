import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { assignContactSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { contactIdForConversation } from "../../services/channel-workflow.service.js";
import {
  assignContactToUser,
  getCurrentAssignment,
} from "../../services/contact.service.js";

export const conversationAssignmentRoutes = new Hono();

async function workflowContactId(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  id: string,
): Promise<string | null> {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (contact) return contact.id;
  return contactIdForConversation(tenantDb, id);
}

conversationAssignmentRoutes.get("/:id/assignment", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = await workflowContactId(tenantDb, c.req.param("id")!);
  if (!contactId) return notFound(c, "Conversation");
  const assignment = await getCurrentAssignment(tenantDb, contactId);
  return successData(c, assignment ?? null);
});

conversationAssignmentRoutes.post(
  "/:id/assign",
  zValidator("json", assignContactSchema),
  async (c) => {
    const { tenantDb, user } = getRouteContext(c);
    const contactId = await workflowContactId(tenantDb, c.req.param("id")!);
    if (!contactId) return notFound(c, "Conversation");
    const targetUserId = c.req.valid("json").targetUserId ?? user.id;
    const assignment = await assignContactToUser(
      tenantDb,
      contactId,
      targetUserId,
      user.id,
    );
    return successData(c, assignment, 201);
  },
);
