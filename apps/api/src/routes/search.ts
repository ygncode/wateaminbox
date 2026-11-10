import { toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { badRequest } from "../lib/errors.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { successData } from "../lib/response.js";
import {
  createPaginationMeta,
  extractPaginationParams,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { contactIdForConversation } from "../services/channel-workflow.service.js";
import * as searchService from "../services/search.service.js";

export const searchRoutes = new Hono();

// All search routes require authentication and tenant context
searchRoutes.use("/*", authMiddleware);
searchRoutes.use("/*", tenantMiddleware());

// Search rate limiter: 30 requests per minute per user
// Uses user-based keys since these are authenticated routes
const searchRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.search,
    keyStrategy: "user",
    keyPrefix: "resource-search",
  },
  rateLimitConfig.enabled,
);

/**
 * GET /search - Global search across messages and contacts
 * Query params: q (required), limit
 * Rate limit: 30 requests per minute per user
 */
searchRoutes.get("/", searchRateLimiter, async (c) => {
  const { companyId, user, permissions } = getRouteContext(c);
  const query = c.req.query("q");
  const { limit } = extractPaginationParams(c, 10);

  if (!query || query.trim().length === 0) {
    return badRequest(c, "Search query is required");
  }

  if (query.trim().length < 2) {
    return badRequest(c, "Search query must be at least 2 characters");
  }

  const results = await searchService.globalSearch(companyId, query.trim(), {
    limit,
    assignedUserId: permissions.can_view_all_chats ? undefined : user.id,
  });

  return successData(c, {
    query: query.trim(),
    ...results,
  });
});

/**
 * GET /search/messages - Search messages only
 * Query params: q (required), limit, offset, contactId, startDate, endDate, messageTypes
 * Rate limit: 30 requests per minute per user
 */
searchRoutes.get("/messages", searchRateLimiter, async (c) => {
  const { companyId, user, permissions, tenantDb } = getRouteContext(c);
  const query = c.req.query("q");
  const { limit, offset } = extractPaginationParams(c);
  const conversationId = c.req.query("conversationId") || undefined;
  const contactId =
    c.req.query("contactId") ||
    (!conversationId
      ? undefined
      : await contactIdForConversation(tenantDb, conversationId));
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const messageTypesStr = c.req.query("messageTypes");

  if (!query || query.trim().length === 0) {
    return badRequest(c, "Search query is required");
  }

  if (query.trim().length < 2) {
    return badRequest(c, "Search query must be at least 2 characters");
  }

  const options: searchService.SearchOptions = {
    query: query.trim(),
    limit,
    offset,
    contactId: contactId || undefined,
    conversationId,
    startDate: startDateStr ? toDbDate(startDateStr) : undefined,
    endDate: endDateStr ? toDbDate(endDateStr) : undefined,
    messageTypes: messageTypesStr
      ? messageTypesStr.split(",").filter(Boolean)
      : undefined,
    assignedUserId: permissions.can_view_all_chats ? undefined : user.id,
  };

  const { results, total } = await searchService.searchMessages(
    companyId,
    options,
  );

  // Search endpoints use a custom response format that includes `query` at top level
  // for debugging and UI display. This is intentional and differs from standard
  // successPaginated which only has { data, pagination }.
  return c.json({
    query: query.trim(),
    data: results,
    pagination: createPaginationMeta(total, results.length, { limit, offset }),
  });
});

/**
 * GET /search/contacts - Search contacts only
 * Query params: q (required), limit, offset, includeGroups
 * Rate limit: 30 requests per minute per user
 */
searchRoutes.get("/contacts", searchRateLimiter, async (c) => {
  const { companyId, user, permissions } = getRouteContext(c);
  const query = c.req.query("q");
  const { limit, offset } = extractPaginationParams(c);
  const includeGroups = c.req.query("includeGroups") !== "false";

  if (!query || query.trim().length === 0) {
    return badRequest(c, "Search query is required");
  }

  const { results, total } = await searchService.searchContacts(
    companyId,
    query.trim(),
    {
      limit,
      offset,
      includeGroups,
      assignedUserId: permissions.can_view_all_chats ? undefined : user.id,
    },
  );

  // Search endpoints use a custom response format that includes `query` at top level
  // for debugging and UI display. See /search/messages for details.
  return c.json({
    query: query.trim(),
    data: results,
    pagination: createPaginationMeta(total, results.length, { limit, offset }),
  });
});
