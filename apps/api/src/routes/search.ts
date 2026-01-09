import { toDbDate } from "@whatsapp-web/shared";
import { Hono } from "hono";
import { badRequest, forbidden, serviceUnavailable } from "../lib/errors.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import {
  extractPaginationParams,
  createPaginationMeta,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as meilisearchService from "../services/meilisearch.service.js";
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
  const { companyId } = getRouteContext(c);
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
  });

  return c.json({
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
  const { companyId } = getRouteContext(c);
  const query = c.req.query("q");
  const { limit, offset } = extractPaginationParams(c);
  const contactId = c.req.query("contactId");
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
    startDate: startDateStr ? toDbDate(startDateStr) : undefined,
    endDate: endDateStr ? toDbDate(endDateStr) : undefined,
    messageTypes: messageTypesStr
      ? messageTypesStr.split(",").filter(Boolean)
      : undefined,
  };

  const { results, total } = await searchService.searchMessages(
    companyId,
    options,
  );

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
  const { companyId } = getRouteContext(c);
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
    },
  );

  return c.json({
    query: query.trim(),
    data: results,
    pagination: createPaginationMeta(total, results.length, { limit, offset }),
  });
});

/**
 * GET /search/status - Get search engine status
 */
searchRoutes.get("/status", async (c) => {
  const { companyId } = getRouteContext(c);

  const meilisearchAvailable =
    await meilisearchService.isMeilisearchAvailable();
  const indexStats = meilisearchAvailable
    ? await meilisearchService.getIndexStats(companyId)
    : null;

  return c.json({
    engine: meilisearchAvailable ? "meilisearch" : "postgresql",
    meilisearch: {
      available: meilisearchAvailable,
      indexedMessages: indexStats?.messages || 0,
      indexedContacts: indexStats?.contacts || 0,
    },
  });
});

/**
 * POST /search/reindex - Rebuild search indexes (admin only)
 */
searchRoutes.post("/reindex", async (c) => {
  const { companyId, role, tenantDb } = getRouteContext(c);

  // Only admins and owners can reindex
  if (role === "member") {
    return forbidden(c, "Insufficient permissions");
  }

  const meilisearchAvailable =
    await meilisearchService.isMeilisearchAvailable();
  if (!meilisearchAvailable) {
    return serviceUnavailable(c, "Meilisearch is not available");
  }

  // Index all messages
  const messages = await tenantDb
    .selectFrom("messages")
    .innerJoin("contacts", "contacts.id", "messages.contact_id")
    .select([
      "messages.id",
      "messages.contact_id",
      "contacts.custom_name",
      "contacts.push_name",
      "contacts.phone_number",
      "contacts.jid",
      "contacts.is_group",
      "messages.message_id",
      "messages.content",
      "messages.message_type",
      "messages.timestamp",
      "messages.from_me",
    ])
    .execute();

  const messageDocuments: meilisearchService.MessageDocument[] = messages
    .filter((m) => m.contact_id !== null)
    .map((m) => ({
      id: m.id,
      companyId,
      contactId: m.contact_id!,
      contactName: m.custom_name || m.push_name || m.phone_number,
      contactJid: m.jid,
      isGroup: m.is_group,
      messageId: m.message_id,
      content: m.content,
      messageType: m.message_type,
      timestamp: Math.floor(new Date(m.timestamp).getTime() / 1000),
      fromMe: m.from_me,
    }));

  await meilisearchService.indexMessages(companyId, messageDocuments);

  // Index all contacts
  const contacts = await tenantDb
    .selectFrom("contacts")
    .select([
      "id",
      "jid",
      "phone_number",
      "push_name",
      "custom_name",
      "is_group",
      "notes_shared",
    ])
    .execute();

  const contactDocuments: meilisearchService.ContactDocument[] = contacts.map(
    (contact) => ({
      id: contact.id,
      companyId,
      jid: contact.jid,
      phoneNumber: contact.phone_number,
      pushName: contact.push_name,
      customName: contact.custom_name,
      displayName:
        contact.custom_name ||
        contact.push_name ||
        contact.phone_number ||
        "Unknown",
      isGroup: contact.is_group,
      notesShared: contact.notes_shared,
    }),
  );

  await meilisearchService.indexContacts(companyId, contactDocuments);

  return c.json({
    success: true,
    indexed: {
      messages: messageDocuments.length,
      contacts: contactDocuments.length,
    },
  });
});
