import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getRouteContext } from "./context.js";

export async function hasContactVisibility(
  c: Context,
  contactId: string,
): Promise<boolean> {
  const { tenantDb, user, permissions } = getRouteContext(c);
  if (permissions.can_view_all_chats) return true;

  const assignment = await tenantDb
    .selectFrom("contact_assignments")
    .select("id")
    .where("contact_id", "=", contactId)
    .where("assigned_to", "=", user.id)
    .where("unassigned_at", "is", null)
    .executeTakeFirst();
  return Boolean(assignment);
}

export function requireContactVisibility(paramName = "id") {
  return async (c: Context, next: Next) => {
    if (!(await hasContactVisibility(c, c.req.param(paramName)))) {
      // Use 404 to avoid disclosing that another assignee's resource exists.
      throw new HTTPException(404, { message: "Contact not found" });
    }
    await next();
  };
}

export function requireMessageVisibility(paramName = "id") {
  return async (c: Context, next: Next) => {
    const { tenantDb, permissions } = getRouteContext(c);
    if (permissions.can_view_all_chats) {
      await next();
      return;
    }
    const message = await tenantDb
      .selectFrom("messages")
      .select("contact_id")
      .where("id", "=", c.req.param(paramName))
      .executeTakeFirst();
    if (
      !message?.contact_id ||
      !(await hasContactVisibility(c, message.contact_id))
    ) {
      throw new HTTPException(404, { message: "Message not found" });
    }
    await next();
  };
}
