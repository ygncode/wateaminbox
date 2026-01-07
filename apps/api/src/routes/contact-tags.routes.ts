import { Hono } from "hono";
import { getRouteContext } from "../middleware/context.js";
import { notFound, badRequest, conflict } from "../lib/errors.js";

export const contactTagsRoutes = new Hono();

/**
 * POST /contacts/:id/tags - Add a tag to a contact
 */
contactTagsRoutes.post("/:id/tags", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { tagId } = body;

  if (!tagId) {
    return badRequest(c, "tagId is required");
  }

  // Check if contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  // Check if tag exists
  const tag = await tenantDb
    .selectFrom("tags")
    .select(["id", "name", "color"])
    .where("id", "=", tagId)
    .executeTakeFirst();

  if (!tag) {
    return notFound(c, "Tag");
  }

  // Check if already tagged
  const existingTag = await tenantDb
    .selectFrom("contact_tags")
    .select(["contact_id", "tag_id"])
    .where("contact_id", "=", contactId)
    .where("tag_id", "=", tagId)
    .executeTakeFirst();

  if (existingTag) {
    return conflict(c, "Tag already exists on contact");
  }

  // Add tag
  await tenantDb
    .insertInto("contact_tags")
    .values({
      contact_id: contactId,
      tag_id: tagId,
    })
    .execute();

  return c.json({
    success: true,
    tag: {
      id: tag.id,
      name: tag.name,
      color: tag.color,
    },
  });
});

/**
 * DELETE /contacts/:id/tags/:tagId - Remove a tag from a contact
 */
contactTagsRoutes.delete("/:id/tags/:tagId", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const tagId = c.req.param("tagId");

  await tenantDb
    .deleteFrom("contact_tags")
    .where("contact_id", "=", contactId)
    .where("tag_id", "=", tagId)
    .execute();

  return c.json({ success: true });
});
