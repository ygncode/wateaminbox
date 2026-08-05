import { Hono } from "hono";
import { badRequest } from "../../lib/errors.js";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import { created, successData } from "../../lib/response.js";
import { uuidSchema } from "../../lib/schemas.js";
import { getRouteContext } from "../../middleware/context.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import { requireAdmin } from "../../middleware/role.js";
import {
  generateImportTemplate,
  importContacts,
  mapToContactRow,
  parseCSV,
  resolveImportConnection,
} from "../../services/import/index.js";

/** Upload ceiling shared by the multipart and JSON request bodies. */
export const MAX_IMPORT_CSV_BYTES = 5 * 1024 * 1024;

/** Ceiling on parsed data rows, so a dense CSV cannot outgrow the byte cap. */
export const MAX_IMPORT_ROWS = 20_000;

/**
 * Extract an optional connectionId from a form-data or JSON request value.
 * Returns undefined when absent, null when present but not a valid UUID.
 */
function parseConnectionIdInput(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Validate a JSON-supplied `csvContent` field.
 *
 * The multipart path is capped by `file.size`; without the same ceiling here a
 * caller could stream an unbounded string into memory and into `parseCSV`.
 * The type check matters too: a non-string value reaches `parseCSV` and throws
 * a 500 rather than being rejected as bad input.
 */
export function validateCsvContentInput(
  value: unknown,
): { ok: true; csvContent: string } | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: false, message: "csvContent must be a string" };
  }
  if (value.length === 0) {
    return { ok: false, message: "csvContent is required" };
  }
  if (Buffer.byteLength(value, "utf8") > MAX_IMPORT_CSV_BYTES) {
    return { ok: false, message: "CSV content must be less than 5MB" };
  }
  return { ok: true, csvContent: value };
}

export const importRoutes = new Hono();

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
importRoutes.get("/import/template", async (c) => {
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
importRoutes.post("/import", requireAdmin(), importRateLimiter, async (c) => {
  const { tenantDb, user } = getRouteContext(c);

  let csvContent: string;
  let updateExisting = true;
  let createTags = true;
  let connectionIdInput: string | null | undefined;

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
    if (file.size > MAX_IMPORT_CSV_BYTES) {
      return badRequest(c, "File size must be less than 5MB");
    }

    csvContent = await file.text();
    updateExisting = updateExistingParam !== "false";
    createTags = createTagsParam !== "false";
    connectionIdInput = parseConnectionIdInput(formData.get("connectionId"));
  } else {
    // Handle JSON with CSV content
    const body = await c.req.json();
    const validated = validateCsvContentInput(body?.csvContent);
    if (!validated.ok) {
      return badRequest(c, validated.message);
    }

    csvContent = validated.csvContent;
    updateExisting = body?.updateExisting !== false;
    createTags = body?.createTags !== false;
    connectionIdInput = parseConnectionIdInput(body?.connectionId);
  }

  if (connectionIdInput === null) {
    return badRequest(c, "connectionId must be a valid UUID");
  }

  // Imported contacts must be linked to a connection or they can never be
  // messaged. Auto-selects the sole connected account; 400s when ambiguous.
  const connection = await resolveImportConnection(tenantDb, connectionIdInput);

  // Parse CSV
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return badRequest(c, "No valid data found in CSV");
  }
  if (parsed.length > MAX_IMPORT_ROWS) {
    return badRequest(
      c,
      `CSV has too many rows. Maximum is ${MAX_IMPORT_ROWS} per import.`,
    );
  }

  // Map to contact rows
  const contactRows = parsed
    .map(mapToContactRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (contactRows.length === 0) {
    return badRequest(
      c,
      "No valid contacts found. Ensure CSV has a phone_number column.",
    );
  }

  // Import contacts
  const summary = await importContacts(tenantDb, contactRows, user.id, {
    connectionId: connection.id,
    updateExisting,
    createTags,
  });

  return created(c, {
    summary: {
      total: summary.total,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      errors: summary.errors,
    },
    results: summary.results,
    connection: {
      id: connection.id,
      name: connection.name,
      phoneNumber: connection.phone_number,
    },
  });
});

/**
 * POST /contacts/import/preview - Preview import without saving
 * Rate limit: 5 requests per minute per user
 */
importRoutes.post("/import/preview", importRateLimiter, async (c) => {
  const { tenantDb } = getRouteContext(c);

  let csvContent: string;
  let connectionIdInput: string | null | undefined;

  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return badRequest(c, "No file provided");
    }

    // Preview is member-accessible, so it needs the same upload ceiling the
    // admin-only import path enforces.
    if (file.size > MAX_IMPORT_CSV_BYTES) {
      return badRequest(c, "File size must be less than 5MB");
    }

    csvContent = await file.text();
    connectionIdInput = parseConnectionIdInput(formData.get("connectionId"));
  } else {
    const body = await c.req.json();
    const validated = validateCsvContentInput(body?.csvContent);
    if (!validated.ok) {
      return badRequest(c, validated.message);
    }
    csvContent = validated.csvContent;
    connectionIdInput = parseConnectionIdInput(body?.connectionId);
  }

  if (connectionIdInput === null) {
    return badRequest(c, "connectionId must be a valid UUID");
  }

  // Resolve the same connection the import will use so exists/new counts
  // reflect what the import would actually do.
  const connection = await resolveImportConnection(tenantDb, connectionIdInput);

  // Parse CSV
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return badRequest(c, "No valid data found in CSV");
  }
  if (parsed.length > MAX_IMPORT_ROWS) {
    return badRequest(
      c,
      `CSV has too many rows. Maximum is ${MAX_IMPORT_ROWS} per import.`,
    );
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

  // Single query to find all existing contacts at once, scoped exactly like
  // the import's duplicate check: rows on the target connection plus unlinked
  // legacy rows the import would adopt. Contacts on other connections are
  // separate rows by design and must not count as "already exists".
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
    .where((eb) =>
      eb.or([
        eb("whatsapp_connection_id", "=", connection.id),
        eb("whatsapp_connection_id", "is", null),
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

  return successData(c, {
    total: preview.length,
    existingCount,
    newCount,
    preview: preview.slice(0, 100), // Limit preview to first 100 rows
    connection: {
      id: connection.id,
      name: connection.name,
      phoneNumber: connection.phone_number,
    },
  });
});
