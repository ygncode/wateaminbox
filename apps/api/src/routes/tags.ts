import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { conflict, notFound } from "../lib/errors.js";
import {
  created,
  successData,
  successMessage,
  successPaginated,
} from "../lib/response.js";
import { createPaginationMeta } from "../lib/route-helpers.js";
import {
  createTagSchema,
  listTagsQuerySchema,
  updateTagSchema,
} from "../lib/schemas/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { tenantMiddleware } from "../middleware/tenant.js";

export const tagRoutes = new Hono();

// All tag routes require authentication and tenant context
tagRoutes.use("/*", authMiddleware);
tagRoutes.use("/*", tenantMiddleware());

/**
 * GET /tags - List all tags with optional pagination
 * Query params: search, limit (default 50), offset (default 0)
 */
tagRoutes.get("/", zValidator("query", listTagsQuerySchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const query = c.req.valid("query");

  const searchPattern = query.search ? `%${query.search}%` : undefined;

  // Keep the count and page under the same case-insensitive name filter.
  const countResult = await tenantDb
    .selectFrom("tags")
    .select((eb) => eb.fn.countAll<string>().as("total"))
    .$if(Boolean(searchPattern), (qb) =>
      qb.where("name", "ilike", searchPattern!),
    )
    .executeTakeFirst();
  const total = Number(countResult?.total || 0);

  const tags = await tenantDb
    .selectFrom("tags")
    .selectAll()
    .$if(Boolean(searchPattern), (qb) =>
      qb.where("name", "ilike", searchPattern!),
    )
    .orderBy("name", "asc")
    .limit(query.limit)
    .offset(query.offset)
    .execute();

  return successPaginated(
    c,
    tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdBy: tag.created_by,
      createdAt: tag.created_at,
    })),
    createPaginationMeta(total, tags.length, {
      limit: query.limit,
      offset: query.offset,
    }),
  );
});

/**
 * POST /tags - Create a new tag
 */
tagRoutes.post("/", zValidator("json", createTagSchema), async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const body = c.req.valid("json");

  // Check if tag with same name exists
  const existingTag = await tenantDb
    .selectFrom("tags")
    .select(["id"])
    .where("name", "ilike", body.name)
    .executeTakeFirst();

  if (existingTag) {
    return conflict(c, "Tag with this name already exists");
  }

  const tag = await tenantDb
    .insertInto("tags")
    .values({
      name: body.name,
      color: body.color || null,
      created_by: user.id,
    })
    .returning(["id", "name", "color", "created_by", "created_at"])
    .executeTakeFirst();

  return created(c, {
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
tagRoutes.patch("/:id", zValidator("json", updateTagSchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const tagId = c.req.param("id");
  const body = c.req.valid("json");

  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updateData.name = body.name;
  }

  if (body.color !== undefined) {
    updateData.color = body.color;
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

  return successData(c, {
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

  return successMessage(c, "Tag deleted successfully");
});
