import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as quickRepliesService from "../services/quick-replies.service.js";

export const quickReplyRoutes = new Hono();

// All quick reply routes require authentication and tenant context
quickReplyRoutes.use("/*", authMiddleware);
quickReplyRoutes.use("/*", tenantMiddleware());

// Validation schemas
const createQuickReplySchema = z.object({
  shortcut: z
    .string()
    .min(1, "Shortcut is required")
    .max(50, "Shortcut must be 50 characters or less")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Shortcut can only contain letters, numbers, underscores, and hyphens",
    ),
  title: z
    .string()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or less"),
  content: z.string().min(1, "Content is required"),
});

const updateQuickReplySchema = z.object({
  shortcut: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  title: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * GET /quick-replies - List all quick replies
 */
quickReplyRoutes.get("/", zValidator("query", listQuerySchema), async (c) => {
  const companyId = c.get("companyId");
  const { search, limit, offset } = c.req.valid("query");

  const result = await quickRepliesService.getQuickReplies(companyId, {
    search,
    limit,
    offset,
  });

  return c.json({
    data: result.quickReplies,
    meta: {
      total: result.total,
      limit,
      offset,
    },
  });
});

/**
 * GET /quick-replies/search/:shortcut - Search by shortcut (for autocomplete)
 */
quickReplyRoutes.get("/search/:shortcut", async (c) => {
  const companyId = c.get("companyId");
  const shortcut = c.req.param("shortcut");

  const quickReply = await quickRepliesService.getQuickReplyByShortcut(
    companyId,
    shortcut,
  );

  if (!quickReply) {
    return c.json({ error: "Quick reply not found" }, 404);
  }

  return c.json({
    data: quickReply,
  });
});

/**
 * GET /quick-replies/:id - Get a quick reply by ID
 */
quickReplyRoutes.get("/:id", async (c) => {
  const companyId = c.get("companyId");
  const quickReplyId = c.req.param("id");

  const quickReply = await quickRepliesService.getQuickReplyById(
    companyId,
    quickReplyId,
  );

  if (!quickReply) {
    return c.json({ error: "Quick reply not found" }, 404);
  }

  return c.json({
    data: quickReply,
  });
});

/**
 * POST /quick-replies - Create a new quick reply
 */
quickReplyRoutes.post(
  "/",
  zValidator("json", createQuickReplySchema),
  async (c) => {
    const user = c.get("user");
    const companyId = c.get("companyId");
    const input = c.req.valid("json");

    try {
      const quickReply = await quickRepliesService.createQuickReply(
        companyId,
        user.id,
        input,
      );

      return c.json(
        {
          data: quickReply,
        },
        201,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
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
    const companyId = c.get("companyId");
    const quickReplyId = c.req.param("id");
    const input = c.req.valid("json");

    try {
      const quickReply = await quickRepliesService.updateQuickReply(
        companyId,
        quickReplyId,
        input,
      );

      if (!quickReply) {
        return c.json({ error: "Quick reply not found" }, 404);
      }

      return c.json({
        data: quickReply,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  },
);

/**
 * DELETE /quick-replies/:id - Delete a quick reply
 */
quickReplyRoutes.delete("/:id", async (c) => {
  const companyId = c.get("companyId");
  const quickReplyId = c.req.param("id");

  const deleted = await quickRepliesService.deleteQuickReply(
    companyId,
    quickReplyId,
  );

  if (!deleted) {
    return c.json({ error: "Quick reply not found" }, 404);
  }

  return c.json({
    data: {
      deleted: true,
    },
  });
});
