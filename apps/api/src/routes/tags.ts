import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";

export const tagRoutes = new Hono();

// All tag routes require authentication and tenant context
tagRoutes.use("/*", authMiddleware);
tagRoutes.use("/*", tenantMiddleware());

/**
 * GET /tags - List all tags
 */
tagRoutes.get("/", async (c) => {
  const tenantDb = c.get("tenantDb");

  const tags = await tenantDb
    .selectFrom("tags")
    .selectAll()
    .orderBy("name", "asc")
    .execute();

  return c.json({
    data: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdBy: tag.created_by,
      createdAt: tag.created_at,
    })),
  });
});

/**
 * POST /tags - Create a new tag
 */
tagRoutes.post("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const body = await c.req.json();

  const { name, color } = body;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  // Check if tag with same name exists
  const existingTag = await tenantDb
    .selectFrom("tags")
    .select(["id"])
    .where("name", "ilike", name)
    .executeTakeFirst();

  if (existingTag) {
    return c.json({ error: "Tag with this name already exists" }, 409);
  }

  const tag = await tenantDb
    .insertInto("tags")
    .values({
      name,
      color: color || null,
      created_by: user.id,
    })
    .returning(["id", "name", "color", "created_by", "created_at"])
    .executeTakeFirst();

  return c.json({
    id: tag?.id,
    name: tag?.name,
    color: tag?.color,
    createdBy: tag?.created_by,
    createdAt: tag?.created_at,
  });
});

/**
 * PATCH /tags/:id - Update a tag
 */
tagRoutes.patch("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const tagId = c.req.param("id");
  const body = await c.req.json();

  const { name, color } = body;

  const updateData: Record<string, unknown> = {};

  if (name !== undefined) {
    updateData.name = name;
  }

  if (color !== undefined) {
    updateData.color = color;
  }

  const tag = await tenantDb
    .updateTable("tags")
    .set(updateData)
    .where("id", "=", tagId)
    .returning(["id", "name", "color", "created_by", "created_at"])
    .executeTakeFirst();

  if (!tag) {
    return c.json({ error: "Tag not found" }, 404);
  }

  return c.json({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    createdBy: tag.created_by,
    createdAt: tag.created_at,
  });
});

/**
 * DELETE /tags/:id - Delete a tag
 */
tagRoutes.delete("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const tagId = c.req.param("id");

  // First remove all contact_tags associations
  await tenantDb
    .deleteFrom("contact_tags")
    .where("tag_id", "=", tagId)
    .execute();

  // Then delete the tag
  const deleted = await tenantDb
    .deleteFrom("tags")
    .where("id", "=", tagId)
    .returning(["id"])
    .executeTakeFirst();

  if (!deleted) {
    return c.json({ error: "Tag not found" }, 404);
  }

  return c.json({ success: true });
});
