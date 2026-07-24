import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { conflict } from "../../lib/errors.js";
import { successData, successMessage } from "../../lib/response.js";
import { requireEntity } from "../../lib/route-helpers.js";
import { addContactTagSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";

export const tagsRoutes = new Hono();

tagsRoutes.use("/:id/*", requireContactVisibility());

/**
 * POST /contacts/:id/tags - Add a tag to a contact
 */
tagsRoutes.post(
  "/:id/tags",
  zValidator("json", addContactTagSchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const contactId = c.req.param("id");
    const body = c.req.valid("json");

    // Check if contact exists (throws NotFoundError if not)
    requireEntity(
      await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .where("id", "=", contactId)
        .executeTakeFirst(),
      "Contact",
    );

    // Check if tag exists (throws NotFoundError if not)
    const tag = requireEntity(
      await tenantDb
        .selectFrom("tags")
        .select(["id", "name", "color"])
        .where("id", "=", body.tagId)
        .executeTakeFirst(),
      "Tag",
    );

    // Check if already tagged
    const existingTag = await tenantDb
      .selectFrom("contact_tags")
      .select(["contact_id", "tag_id"])
      .where("contact_id", "=", contactId)
      .where("tag_id", "=", body.tagId)
      .executeTakeFirst();

    if (existingTag) {
      return conflict(c, "Tag already exists on contact");
    }

    // Add tag
    await tenantDb
      .insertInto("contact_tags")
      .values({
        contact_id: contactId,
        tag_id: body.tagId,
      })
      .execute();

    return successData(c, {
      tag: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
      },
    });
  },
);

/**
 * DELETE /contacts/:id/tags/:tagId - Remove a tag from a contact
 */
tagsRoutes.delete("/:id/tags/:tagId", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const tagId = c.req.param("tagId");

  await tenantDb
    .deleteFrom("contact_tags")
    .where("contact_id", "=", contactId)
    .where("tag_id", "=", tagId)
    .execute();

  return successMessage(c, "Tag removed");
});
