import { Hono } from "hono";
import { badRequest, isTableNotFoundError, notFound } from "../lib/errors.js";
import { enqueueConnectionCommand } from "../services/command-outbox.service.js";
import {
  successData,
  successMessage,
  successWithMessage,
} from "../lib/response.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { requirePermission, tenantMiddleware } from "../middleware/tenant.js";
import {
  getWhatsAppCatalogs,
  getWhatsAppCatalogByCatalogId,
  getCatalogProducts,
  getCatalogSyncStatus,
  archiveCatalog,
  restoreCatalog,
  updateProductVisibility,
} from "../services/catalog-sync.service.js";
import { PERMISSIONS } from "../services/permission.service.js";
import {
  getActiveWhatsAppConnection,
  getWhatsAppConnection,
} from "../services/whatsapp-connection.service.js";

// ProductVisibility type defined locally to avoid import issues
type ProductVisibility = "visible" | "hidden";

export const catalogRoutes = new Hono();

// All catalog routes require authentication and tenant context
catalogRoutes.use("/*", authMiddleware);
catalogRoutes.use("/*", tenantMiddleware());
catalogRoutes.use("/*", requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS));

/**
 * GET /catalogs - List all WhatsApp Business catalogs
 */
catalogRoutes.get("/", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  try {
    const catalogs = await getWhatsAppCatalogs(tenantDb, connection.id);
    return successData(c, catalogs);
  } catch (error) {
    // Handle missing table gracefully - return empty array
    if (isTableNotFoundError(error)) {
      return successData(c, []);
    }
    throw error;
  }
});

/**
 * GET /catalogs/status - Get catalog sync status summary
 */
catalogRoutes.get("/status", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  try {
    const status = await getCatalogSyncStatus(tenantDb, connection.id);
    return successData(c, status);
  } catch (error) {
    // Handle missing table gracefully - return empty status
    if (isTableNotFoundError(error)) {
      return successData(c, {
        totalCatalogs: 0,
        activeCatalogs: 0,
        totalProducts: 0,
        lastSyncAt: null,
      });
    }
    throw error;
  }
});

/**
 * GET /catalogs/:catalogId - Get a specific catalog
 */
catalogRoutes.get("/:catalogId", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const catalogId = c.req.param("catalogId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  const catalog = await getWhatsAppCatalogByCatalogId(
    tenantDb,
    catalogId,
    connection.id,
  );

  if (!catalog) {
    return notFound(c, "Catalog");
  }

  return successData(c, catalog);
});

/**
 * GET /catalogs/:catalogId/products - Get products for a catalog
 */
catalogRoutes.get("/:catalogId/products", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const catalogId = c.req.param("catalogId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  // Verify catalog exists
  const catalog = await getWhatsAppCatalogByCatalogId(
    tenantDb,
    catalogId,
    connection.id,
  );

  if (!catalog) {
    return notFound(c, "Catalog");
  }

  const products = await getCatalogProducts(tenantDb, catalogId, connection.id);

  return successData(c, {
    products,
    meta: {
      catalogId,
      catalogName: catalog.name,
      totalProducts: products.length,
    },
  });
});

/**
 * POST /catalogs/sync - Trigger a sync of catalogs from WhatsApp Business
 * This sends a command to the Go service to fetch catalogs
 */
catalogRoutes.post("/sync", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);

  // Check if WhatsApp is connected (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  await tenantDb
    .transaction()
    .execute((trx) =>
      enqueueConnectionCommand(trx, companyId, connection.id, (publisher) =>
        publisher.syncCatalogs(user.id),
      ),
    );

  return successWithMessage(
    c,
    "Catalog sync initiated. Catalogs will be updated shortly.",
    { status: "syncing" },
  );
});

/**
 * POST /catalogs/:catalogId/sync-products - Trigger a sync of products for a specific catalog
 */
catalogRoutes.post("/:catalogId/sync-products", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const catalogId = c.req.param("catalogId");

  // Verify catalog exists
  const requestedConnection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );
  const catalog = await getWhatsAppCatalogByCatalogId(
    tenantDb,
    catalogId,
    requestedConnection.id,
  );

  if (!catalog) {
    return notFound(c, "Catalog");
  }

  // Check if WhatsApp is connected (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(
    tenantDb,
    requestedConnection.id,
  );

  await tenantDb
    .transaction()
    .execute((trx) =>
      enqueueConnectionCommand(trx, companyId, connection.id, (publisher) =>
        publisher.syncCatalogProducts(catalogId, user.id),
      ),
    );

  return successWithMessage(
    c,
    "Product sync initiated for catalog. Products will be updated shortly.",
    { status: "syncing", catalogId },
  );
});

/**
 * POST /catalogs/:catalogId/archive - Archive a catalog
 */
catalogRoutes.post("/:catalogId/archive", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const catalogId = c.req.param("catalogId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  const result = await archiveCatalog(tenantDb, connection.id, catalogId);

  if (!result.success) {
    return badRequest(c, result.error || "Failed to archive catalog");
  }

  return successMessage(c, "Catalog archived successfully");
});

/**
 * POST /catalogs/:catalogId/restore - Restore an archived catalog
 */
catalogRoutes.post("/:catalogId/restore", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const catalogId = c.req.param("catalogId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  const result = await restoreCatalog(tenantDb, connection.id, catalogId);

  if (!result.success) {
    return badRequest(c, result.error || "Failed to restore catalog");
  }

  return successMessage(c, "Catalog restored successfully");
});

/**
 * PATCH /catalogs/:catalogId/products/:productId/visibility - Update product visibility
 */
catalogRoutes.patch("/:catalogId/products/:productId/visibility", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const catalogId = c.req.param("catalogId");
  const productId = c.req.param("productId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );
  const body = await c.req.json();

  const { visibility } = body as { visibility: ProductVisibility };

  if (!visibility || !["visible", "hidden"].includes(visibility)) {
    return badRequest(c, "visibility must be 'visible' or 'hidden'");
  }

  const result = await updateProductVisibility(
    tenantDb,
    connection.id,
    productId,
    catalogId,
    visibility,
  );

  if (!result.success) {
    return badRequest(c, result.error || "Failed to update product visibility");
  }

  return successMessage(c, `Product visibility updated to ${visibility}`);
});
