import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as searchService from "../services/search.service.js";
import * as meilisearchService from "../services/meilisearch.service.js";
import { getTenantConnection } from "../services/tenant.service.js";

export const searchRoutes = new Hono();

// All search routes require authentication and tenant context
searchRoutes.use("/*", authMiddleware);
searchRoutes.use("/*", tenantMiddleware());

/**
 * GET /search - Global search across messages and contacts
 * Query params: q (required), limit
 */
searchRoutes.get("/", async (c) => {
  const companyId = c.get("companyId");
  const query = c.req.query("q");
  const limit = parseInt(c.req.query("limit") || "10", 10);

  if (!query || query.trim().length === 0) {
    return c.json({ error: "Search query is required" }, 400);
  }

  if (query.trim().length < 2) {
    return c.json({ error: "Search query must be at least 2 characters" }, 400);
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
 */
searchRoutes.get("/messages", async (c) => {
  const companyId = c.get("companyId");
  const query = c.req.query("q");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const contactId = c.req.query("contactId");
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const messageTypesStr = c.req.query("messageTypes");

  if (!query || query.trim().length === 0) {
    return c.json({ error: "Search query is required" }, 400);
  }

  if (query.trim().length < 2) {
    return c.json({ error: "Search query must be at least 2 characters" }, 400);
  }

  const options: searchService.SearchOptions = {
    query: query.trim(),
    limit,
    offset,
    contactId: contactId || undefined,
    startDate: startDateStr ? new Date(startDateStr) : undefined,
    endDate: endDateStr ? new Date(endDateStr) : undefined,
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
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    },
  });
});

/**
 * GET /search/contacts - Search contacts only
 * Query params: q (required), limit, offset, includeGroups
 */
searchRoutes.get("/contacts", async (c) => {
  const companyId = c.get("companyId");
  const query = c.req.query("q");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const includeGroups = c.req.query("includeGroups") !== "false";

  if (!query || query.trim().length === 0) {
    return c.json({ error: "Search query is required" }, 400);
  }

  const { results, total } = await searchService.searchContacts(
    companyId,
    query.trim(),
    { limit, offset, includeGroups },
  );

  return c.json({
    query: query.trim(),
    data: results,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    },
  });
});

/**
 * GET /search/status - Get search engine status
 */
searchRoutes.get("/status", async (c) => {
  const companyId = c.get("companyId");

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
  const companyId = c.get("companyId");
  const role = c.get("companyRole");

  // Only admins and owners can reindex
  if (role === "member") {
    return c.json({ error: "Insufficient permissions" }, 403);
  }

  const meilisearchAvailable =
    await meilisearchService.isMeilisearchAvailable();
  if (!meilisearchAvailable) {
    return c.json({ error: "Meilisearch is not available" }, 503);
  }

  const tenantDb = getTenantConnection(companyId);

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
    (c) => ({
      id: c.id,
      companyId,
      jid: c.jid,
      phoneNumber: c.phone_number,
      pushName: c.push_name,
      customName: c.custom_name,
      displayName: c.custom_name || c.push_name || c.phone_number || "Unknown",
      isGroup: c.is_group,
      notesShared: c.notes_shared,
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
