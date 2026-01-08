import { Hono } from "hono";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  createPaginationMeta,
  extractPaginationParams,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";

export const tagRoutes = new Hono();

// All tag routes require authentication and tenant context
tagRoutes.use("/*", authMiddleware);
tagRoutes.use("/*", tenantMiddleware());

/**
 * GET /tags - List all tags with optional pagination
 * Query params: limit (default 50), offset (default 0)
 */
tagRoutes.get("/", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const { limit, offset } = extractPaginationParams(c);

  // Get total count
  const countResult = await tenantDb
    .selectFrom("tags")
    .select((eb) => eb.fn.countAll<string>().as("total"))
    .executeTakeFirst();
  const total = Number(countResult?.total || 0);

  // Get paginated tags
  const tags = await tenantDb
    .selectFrom("tags")
    .selectAll()
    .orderBy("name", "asc")
    .limit(limit)
    .offset(offset)
    .execute();

  return c.json({
    data: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdBy: tag.created_by,
      createdAt: tag.created_at,
    })),
    pagination: createPaginationMeta(total, tags.length, { limit, offset }),
  });
});

/**
 * POST /tags - Create a new tag
 */
tagRoutes.post("/", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const body = await c.req.json();

  const { name, color } = body;

  if (!name) {
    return badRequest(c, "name is required");
  }

  // Check if tag with same name exists
  const existingTag = await tenantDb
    .selectFrom("tags")
    .select(["id"])
    .where("name", "ilike", name)
    .executeTakeFirst();

  if (existingTag) {
    return conflict(c, "Tag with this name already exists");
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
  const { tenantDb } = getRouteContext(c);
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
    return notFound(c, "Tag");
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
  const { tenantDb } = getRouteContext(c);
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
    return notFound(c, "Tag");
  }

  return c.json({ success: true });
});
