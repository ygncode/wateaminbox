import { Hono } from "hono"
import { authMiddleware } from "../middleware/auth.js"
import { tenantMiddleware } from "../middleware/tenant.js"
import {
  getWhatsAppCatalogs,
  getWhatsAppCatalogByCatalogId,
  getCatalogProducts,
  getCatalogSyncStatus,
  archiveCatalog,
  restoreCatalog,
  updateProductVisibility,
} from "../services/catalog-sync.service.js"
import {
  publishSyncCatalogs,
  publishSyncCatalogProducts,
} from "../lib/nats.js"
import type { ProductVisibility } from "@whatsapp-web/database"

export const catalogRoutes = new Hono()

// All catalog routes require authentication and tenant context
catalogRoutes.use("/*", authMiddleware)
catalogRoutes.use("/*", tenantMiddleware())

/**
 * GET /catalogs - List all WhatsApp Business catalogs
 */
catalogRoutes.get("/", async (c) => {
  const tenantDb = c.get("tenantDb")

  const catalogs = await getWhatsAppCatalogs(tenantDb)

  return c.json({
    data: catalogs,
  })
})

/**
 * GET /catalogs/status - Get catalog sync status summary
 */
catalogRoutes.get("/status", async (c) => {
  const tenantDb = c.get("tenantDb")

  const status = await getCatalogSyncStatus(tenantDb)

  return c.json(status)
})

/**
 * GET /catalogs/:catalogId - Get a specific catalog
 */
catalogRoutes.get("/:catalogId", async (c) => {
  const tenantDb = c.get("tenantDb")
  const catalogId = c.req.param("catalogId")

  const catalog = await getWhatsAppCatalogByCatalogId(tenantDb, catalogId)

  if (!catalog) {
    return c.json({ error: "Catalog not found" }, 404)
  }

  return c.json(catalog)
})

/**
 * GET /catalogs/:catalogId/products - Get products for a catalog
 */
catalogRoutes.get("/:catalogId/products", async (c) => {
  const tenantDb = c.get("tenantDb")
  const catalogId = c.req.param("catalogId")

  // Verify catalog exists
  const catalog = await getWhatsAppCatalogByCatalogId(tenantDb, catalogId)

  if (!catalog) {
    return c.json({ error: "Catalog not found" }, 404)
  }

  const products = await getCatalogProducts(tenantDb, catalogId)

  return c.json({
    data: products,
    meta: {
      catalogId,
      catalogName: catalog.name,
      totalProducts: products.length,
    },
  })
})

/**
 * POST /catalogs/sync - Trigger a sync of catalogs from WhatsApp Business
 * This sends a command to the Go service to fetch catalogs
 */
catalogRoutes.post("/sync", async (c) => {
  const user = c.get("user")
  const companyId = c.get("companyId")
  const tenantDb = c.get("tenantDb")

  // Check if WhatsApp is connected
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "=", "connected")
    .executeTakeFirst()

  if (!connection) {
    return c.json(
      { error: "WhatsApp is not connected. Please connect first." },
      400,
    )
  }

  // Publish sync command to NATS
  await publishSyncCatalogs(companyId, user.id)

  return c.json({
    message: "Catalog sync initiated. Catalogs will be updated shortly.",
    status: "syncing",
  })
})

/**
 * POST /catalogs/:catalogId/sync-products - Trigger a sync of products for a specific catalog
 */
catalogRoutes.post("/:catalogId/sync-products", async (c) => {
  const user = c.get("user")
  const companyId = c.get("companyId")
  const tenantDb = c.get("tenantDb")
  const catalogId = c.req.param("catalogId")

  // Verify catalog exists
  const catalog = await getWhatsAppCatalogByCatalogId(tenantDb, catalogId)

  if (!catalog) {
    return c.json({ error: "Catalog not found" }, 404)
  }

  // Check if WhatsApp is connected
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "=", "connected")
    .executeTakeFirst()

  if (!connection) {
    return c.json(
      { error: "WhatsApp is not connected. Please connect first." },
      400,
    )
  }

  // Publish sync command to NATS
  await publishSyncCatalogProducts(companyId, catalogId, user.id)

  return c.json({
    message: "Product sync initiated for catalog. Products will be updated shortly.",
    status: "syncing",
    catalogId,
  })
})

/**
 * POST /catalogs/:catalogId/archive - Archive a catalog
 */
catalogRoutes.post("/:catalogId/archive", async (c) => {
  const tenantDb = c.get("tenantDb")
  const catalogId = c.req.param("catalogId")

  const result = await archiveCatalog(tenantDb, catalogId)

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json({
    success: true,
    message: "Catalog archived successfully",
  })
})

/**
 * POST /catalogs/:catalogId/restore - Restore an archived catalog
 */
catalogRoutes.post("/:catalogId/restore", async (c) => {
  const tenantDb = c.get("tenantDb")
  const catalogId = c.req.param("catalogId")

  const result = await restoreCatalog(tenantDb, catalogId)

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json({
    success: true,
    message: "Catalog restored successfully",
  })
})

/**
 * PATCH /catalogs/:catalogId/products/:productId/visibility - Update product visibility
 */
catalogRoutes.patch("/:catalogId/products/:productId/visibility", async (c) => {
  const tenantDb = c.get("tenantDb")
  const catalogId = c.req.param("catalogId")
  const productId = c.req.param("productId")
  const body = await c.req.json()

  const { visibility } = body as { visibility: ProductVisibility }

  if (!visibility || !["visible", "hidden"].includes(visibility)) {
    return c.json({ error: "visibility must be 'visible' or 'hidden'" }, 400)
  }

  const result = await updateProductVisibility(tenantDb, productId, catalogId, visibility)

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json({
    success: true,
    message: `Product visibility updated to ${visibility}`,
  })
})
