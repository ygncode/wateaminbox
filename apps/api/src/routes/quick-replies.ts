import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import * as quickRepliesService from "../services/quick-replies.service.js";
import { conflict, isTableNotFoundError, notFound } from "../lib/errors.js";
import {
  created,
  successData,
  successMessage,
  successPaginated,
  type PaginationMeta,
} from "../lib/response.js";
import {
  createQuickReplySchema,
  updateQuickReplySchema,
  listQuickRepliesQuerySchema,
} from "../lib/schemas/index.js";

export const quickReplyRoutes = new Hono();

// All quick reply routes require authentication and tenant context
quickReplyRoutes.use("/*", authMiddleware);
quickReplyRoutes.use("/*", tenantMiddleware());

/**
 * GET /quick-replies - List all quick replies
 */
quickReplyRoutes.get(
  "/",
  zValidator("query", listQuickRepliesQuerySchema),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const { search, limit, offset } = c.req.valid("query");

    try {
      const result = await quickRepliesService.getQuickReplies(companyId, {
        search,
        limit,
        offset,
      });

      const pagination: PaginationMeta = {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      };

      return successPaginated(c, result.quickReplies, pagination);
    } catch (error) {
      // Handle missing table gracefully - return empty array
      if (isTableNotFoundError(error)) {
        const pagination: PaginationMeta = {
          total: 0,
          limit,
          offset,
          hasMore: false,
        };
        return successPaginated(c, [], pagination);
      }
      throw error;
    }
  },
);

/**
 * GET /quick-replies/search/:shortcut - Search by shortcut (for autocomplete)
 */
quickReplyRoutes.get("/search/:shortcut", async (c) => {
  const { companyId } = getRouteContext(c);
  const shortcut = c.req.param("shortcut");

  const quickReply = await quickRepliesService.getQuickReplyByShortcut(
    companyId,
    shortcut,
  );

  if (!quickReply) {
    return notFound(c, "Quick reply");
  }

  return successData(c, quickReply);
});

/**
 * GET /quick-replies/:id - Get a quick reply by ID
 */
quickReplyRoutes.get("/:id", async (c) => {
  const { companyId } = getRouteContext(c);
  const quickReplyId = c.req.param("id");

  const quickReply = await quickRepliesService.getQuickReplyById(
    companyId,
    quickReplyId,
  );

  if (!quickReply) {
    return notFound(c, "Quick reply");
  }

  return successData(c, quickReply);
});

/**
 * POST /quick-replies - Create a new quick reply
 */
quickReplyRoutes.post(
  "/",
  zValidator("json", createQuickReplySchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const input = c.req.valid("json");

    try {
      const quickReply = await quickRepliesService.createQuickReply(
        companyId,
        user.id,
        input,
      );

      return created(c, quickReply);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return conflict(c, error.message);
      }
      throw error;
    }
  },
);

/**
 * PATCH /quick-replies/:id - Update a quick reply
 */
quickReplyRoutes.patch(
  "/:id",
  zValidator("json", updateQuickReplySchema),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const quickReplyId = c.req.param("id");
    const input = c.req.valid("json");

    try {
      const quickReply = await quickRepliesService.updateQuickReply(
        companyId,
        quickReplyId,
        input,
      );

      if (!quickReply) {
        return notFound(c, "Quick reply");
      }

      return successData(c, quickReply);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return conflict(c, error.message);
      }
      throw error;
    }
  },
);

/**
 * DELETE /quick-replies/:id - Delete a quick reply
 */
quickReplyRoutes.delete("/:id", async (c) => {
  const { companyId } = getRouteContext(c);
  const quickReplyId = c.req.param("id");

  const deleted = await quickRepliesService.deleteQuickReply(
    companyId,
    quickReplyId,
  );

  if (!deleted) {
    return notFound(c, "Quick reply");
  }

  return successMessage(c, "Quick reply deleted successfully");
});
