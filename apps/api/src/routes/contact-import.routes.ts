import { Hono } from "hono";
import { badRequest } from "../lib/errors.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { getRouteContext } from "../middleware/context.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import {
  generateImportTemplate,
  importContacts,
  mapToContactRow,
  parseCSV,
} from "../services/import/index.js";

export const contactImportRoutes = new Hono();

// Import rate limiter: 5 requests per minute per user
// Bulk contact import is resource-intensive, so we use a strict limit
const importRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.import,
    keyStrategy: "user",
    keyPrefix: "resource-import",
  },
  rateLimitConfig.enabled,
);

/**
 * GET /contacts/import/template - Download CSV template for import
 */
contactImportRoutes.get("/import/template", async (c) => {
  const csv = generateImportTemplate();

  c.header("Content-Type", "text/csv");
  c.header(
    "Content-Disposition",
    'attachment; filename="contact-import-template.csv"',
  );
  return c.body(csv);
});

/**
 * POST /contacts/import - Import contacts from CSV
 * Accepts: multipart/form-data with file field, or JSON with csvContent field
 * Rate limit: 5 requests per minute per user
 */
contactImportRoutes.post("/import", importRateLimiter, async (c) => {
  const { tenantDb, user } = getRouteContext(c);

  let csvContent: string;
  let updateExisting = true;
  let createTags = true;

  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    // Handle file upload
    const formData = await c.req.formData();
    const file = formData.get("file");
    const updateExistingParam = formData.get("updateExisting");
    const createTagsParam = formData.get("createTags");

    if (!file || !(file instanceof File)) {
      return badRequest(c, "No file provided");
    }

    // Check file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv")) {
      return badRequest(c, "Only CSV files are supported");
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return badRequest(c, "File size must be less than 5MB");
    }

    csvContent = await file.text();
    updateExisting = updateExistingParam !== "false";
    createTags = createTagsParam !== "false";
  } else {
    // Handle JSON with CSV content
    const body = await c.req.json();
    if (!body.csvContent) {
      return badRequest(c, "csvContent is required");
    }

    csvContent = body.csvContent;
    updateExisting = body.updateExisting !== false;
    createTags = body.createTags !== false;
  }

  // Parse CSV
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return badRequest(c, "No valid data found in CSV");
  }

  // Map to contact rows
  const contactRows = parsed
    .map(mapToContactRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (contactRows.length === 0) {
    return c.json(
      {
        error: "No valid contacts found. Ensure CSV has a phone_number column.",
      },
      400,
    );
  }

  // Import contacts
  const summary = await importContacts(tenantDb, contactRows, user.id, {
    updateExisting,
    createTags,
  });

  return c.json({
    success: true,
    summary: {
      total: summary.total,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      errors: summary.errors,
    },
    results: summary.results,
  });
});

/**
 * POST /contacts/import/preview - Preview import without saving
 * Rate limit: 5 requests per minute per user
 */
contactImportRoutes.post("/import/preview", importRateLimiter, async (c) => {
  const { tenantDb } = getRouteContext(c);

  let csvContent: string;

  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return badRequest(c, "No file provided");
    }

    csvContent = await file.text();
  } else {
    const body = await c.req.json();
    if (!body.csvContent) {
      return badRequest(c, "csvContent is required");
    }
    csvContent = body.csvContent;
  }

  // Parse CSV
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return badRequest(c, "No valid data found in CSV");
  }

  // Map to contact rows
  const contactRows = parsed
    .map(mapToContactRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);

  // Batch lookup: Check which contacts already exist in a single query
  // Build arrays of phone numbers and JIDs for batch query
  const lookupData = contactRows.map((row) => {
    const phoneNumber = row.phone_number.replace(/[^\d]/g, "");
    return {
      originalPhoneNumber: row.phone_number,
      cleanPhoneNumber: phoneNumber,
      jid: `${phoneNumber}@s.whatsapp.net`,
    };
  });

  // Single query to find all existing contacts at once
  const existingContacts = await tenantDb
    .selectFrom("contacts")
    .select(["jid", "phone_number", "custom_name", "push_name"])
    .where((eb) =>
      eb.or([
        // Match by JID
        eb(
          "jid",
          "in",
          lookupData.map((d) => d.jid),
        ),
        // Match by phone number (normalized)
        eb(
          "phone_number",
          "in",
          lookupData.map((d) => d.cleanPhoneNumber),
        ),
      ]),
    )
    .execute();

  // Build a Map for O(1) existence checks - key can be jid or phone_number
  const existingMap = new Map<
    string,
    { customName: string | null; pushName: string | null }
  >();
  for (const contact of existingContacts) {
    if (contact.jid) {
      existingMap.set(contact.jid, {
        customName: contact.custom_name,
        pushName: contact.push_name,
      });
    }
    if (contact.phone_number) {
      existingMap.set(contact.phone_number.replace(/[^\d]/g, ""), {
        customName: contact.custom_name,
        pushName: contact.push_name,
      });
    }
  }

  // Build preview using the Map for instant lookups
  const preview = lookupData.map((data, index) => {
    const existing =
      existingMap.get(data.jid) || existingMap.get(data.cleanPhoneNumber);
    const contactRow = contactRows[index];

    return {
      row: index + 1,
      phoneNumber: data.originalPhoneNumber,
      name: contactRow.custom_name || null,
      notes: contactRow.notes || null,
      tags: contactRow.tags || null,
      exists: !!existing,
      existingName: existing?.customName || existing?.pushName || null,
    };
  });

  const existingCount = preview.filter((p) => p.exists).length;
  const newCount = preview.filter((p) => !p.exists).length;

  return c.json({
    total: preview.length,
    existingCount,
    newCount,
    preview: preview.slice(0, 100), // Limit preview to first 100 rows
  });
});
