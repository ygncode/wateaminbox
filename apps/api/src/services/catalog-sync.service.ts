import type { Kysely } from "kysely";
import type { TenantDatabase } from "@whatsapp-web/database";

// Types defined locally to avoid import issues
export type CatalogStatus = "active" | "inactive" | "archived";
export type ProductVisibility = "visible" | "hidden";

export interface WhatsAppCatalog {
  catalogId: string;
  name: string;
  description?: string;
  currency?: string;
  status?: CatalogStatus;
  businessJid?: string;
  headerImageUrl?: string;
  productCount?: number;
}

export interface WhatsAppProduct {
  productId: string;
  catalogId: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  imageUrls?: string[];
  sku?: string;
  category?: string;
  availability?: string;
  visibility?: ProductVisibility;
  url?: string;
  retailerId?: string;
}

export interface SyncedCatalog {
  id: string;
  catalogId: string;
  name: string;
  description: string | null;
  currency: string;
  status: CatalogStatus;
  businessJid: string | null;
  headerImageUrl: string | null;
  productCount: number;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncedProduct {
  id: string;
  productId: string;
  catalogId: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  imageUrls: string[] | null;
  sku: string | null;
  category: string | null;
  availability: string;
  visibility: ProductVisibility;
  url: string | null;
  retailerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface ProductSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * Get all WhatsApp catalogs from the database
 */
export async function getWhatsAppCatalogs(
  tenantDb: Kysely<TenantDatabase>,
): Promise<SyncedCatalog[]> {
  const catalogs = await tenantDb
    .selectFrom("whatsapp_catalogs")
    .selectAll()
    .orderBy("name", "asc")
    .execute();

  return catalogs.map((catalog) => ({
    id: catalog.id,
    catalogId: catalog.catalog_id,
    name: catalog.name,
    description: catalog.description,
    currency: catalog.currency,
    status: catalog.status,
    businessJid: catalog.business_jid,
    headerImageUrl: catalog.header_image_url,
    productCount: catalog.product_count,
    lastSyncedAt: catalog.last_synced_at,
    createdAt: catalog.created_at,
    updatedAt: catalog.updated_at,
  }));
}

/**
 * Get a single WhatsApp catalog by catalog ID
 */
export async function getWhatsAppCatalogByCatalogId(
  tenantDb: Kysely<TenantDatabase>,
  catalogId: string,
): Promise<SyncedCatalog | null> {
  const catalog = await tenantDb
    .selectFrom("whatsapp_catalogs")
    .selectAll()
    .where("catalog_id", "=", catalogId)
    .executeTakeFirst();

  if (!catalog) return null;

  return {
    id: catalog.id,
    catalogId: catalog.catalog_id,
    name: catalog.name,
    description: catalog.description,
    currency: catalog.currency,
    status: catalog.status,
    businessJid: catalog.business_jid,
    headerImageUrl: catalog.header_image_url,
    productCount: catalog.product_count,
    lastSyncedAt: catalog.last_synced_at,
    createdAt: catalog.created_at,
    updatedAt: catalog.updated_at,
  };
}

/**
 * Get products for a specific catalog
 */
export async function getCatalogProducts(
  tenantDb: Kysely<TenantDatabase>,
  catalogId: string,
): Promise<SyncedProduct[]> {
  const products = await tenantDb
    .selectFrom("catalog_products")
    .selectAll()
    .where("catalog_id", "=", catalogId)
    .orderBy("name", "asc")
    .execute();

  return products.map((product) => ({
    id: product.id,
    productId: product.product_id,
    catalogId: product.catalog_id,
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    imageUrls: product.image_urls,
    sku: product.sku,
    category: product.category,
    availability: product.availability,
    visibility: product.visibility,
    url: product.url,
    retailerId: product.retailer_id,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  }));
}

/**
 * Get a single product by product ID and catalog ID
 */
export async function getProductByProductId(
  tenantDb: Kysely<TenantDatabase>,
  productId: string,
  catalogId: string,
): Promise<SyncedProduct | null> {
  const product = await tenantDb
    .selectFrom("catalog_products")
    .selectAll()
    .where("product_id", "=", productId)
    .where("catalog_id", "=", catalogId)
    .executeTakeFirst();

  if (!product) return null;

  return {
    id: product.id,
    productId: product.product_id,
    catalogId: product.catalog_id,
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    imageUrls: product.image_urls,
    sku: product.sku,
    category: product.category,
    availability: product.availability,
    visibility: product.visibility,
    url: product.url,
    retailerId: product.retailer_id,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  };
}

/**
 * Sync WhatsApp catalogs from Go service into the database
 * This processes catalogs fetched from WhatsApp Business API
 */
export async function syncCatalogsFromWhatsApp(
  tenantDb: Kysely<TenantDatabase>,
  catalogs: WhatsAppCatalog[],
): Promise<CatalogSyncResult> {
  let added = 0;
  let updated = 0;

  // Get existing catalogs
  const existingCatalogs = await tenantDb
    .selectFrom("whatsapp_catalogs")
    .select(["id", "catalog_id", "name", "description"])
    .execute();

  const existingMap = new Map(existingCatalogs.map((c) => [c.catalog_id, c]));
  const incomingCatalogIds = new Set(catalogs.map((c) => c.catalogId));

  // Process incoming catalogs
  for (const catalog of catalogs) {
    const existing = existingMap.get(catalog.catalogId);

    if (existing) {
      // Update existing catalog
      await tenantDb
        .updateTable("whatsapp_catalogs")
        .set({
          name: catalog.name,
          description: catalog.description ?? null,
          currency: catalog.currency ?? "USD",
          status: catalog.status ?? "active",
          business_jid: catalog.businessJid ?? null,
          header_image_url: catalog.headerImageUrl ?? null,
          product_count: catalog.productCount ?? 0,
          last_synced_at: new Date(),
          updated_at: new Date(),
        })
        .where("catalog_id", "=", catalog.catalogId)
        .execute();
      updated++;
    } else {
      // Insert new catalog
      await tenantDb
        .insertInto("whatsapp_catalogs")
        .values({
          catalog_id: catalog.catalogId,
          name: catalog.name,
          description: catalog.description ?? null,
          currency: catalog.currency ?? "USD",
          status: catalog.status ?? "active",
          business_jid: catalog.businessJid ?? null,
          header_image_url: catalog.headerImageUrl ?? null,
          product_count: catalog.productCount ?? 0,
          last_synced_at: new Date(),
        })
        .execute();
      added++;
    }
  }

  // Remove catalogs that no longer exist in WhatsApp
  const toRemove = existingCatalogs.filter(
    (c) => !incomingCatalogIds.has(c.catalog_id),
  );
  let removed = 0;

  for (const catalog of toRemove) {
    // Delete products first
    await tenantDb
      .deleteFrom("catalog_products")
      .where("catalog_id", "=", catalog.catalog_id)
      .execute();

    // Then delete catalog
    await tenantDb
      .deleteFrom("whatsapp_catalogs")
      .where("catalog_id", "=", catalog.catalog_id)
      .execute();
    removed++;
  }

  return {
    added,
    updated,
    removed,
    total: catalogs.length,
  };
}

/**
 * Sync products for a specific catalog from WhatsApp
 */
export async function syncCatalogProductsFromWhatsApp(
  tenantDb: Kysely<TenantDatabase>,
  catalogId: string,
  products: WhatsAppProduct[],
): Promise<ProductSyncResult> {
  let added = 0;
  let updated = 0;

  // Get existing products for this catalog
  const existingProducts = await tenantDb
    .selectFrom("catalog_products")
    .select(["id", "product_id", "name"])
    .where("catalog_id", "=", catalogId)
    .execute();

  const existingMap = new Map(existingProducts.map((p) => [p.product_id, p]));
  const incomingProductIds = new Set(products.map((p) => p.productId));

  // Process incoming products
  for (const product of products) {
    const existing = existingMap.get(product.productId);

    if (existing) {
      // Update existing product
      await tenantDb
        .updateTable("catalog_products")
        .set({
          name: product.name,
          description: product.description ?? null,
          price: product.price ?? null,
          currency: product.currency ?? "USD",
          image_urls: product.imageUrls ?? null,
          sku: product.sku ?? null,
          category: product.category ?? null,
          availability: product.availability ?? "in_stock",
          visibility: product.visibility ?? "visible",
          url: product.url ?? null,
          retailer_id: product.retailerId ?? null,
          updated_at: new Date(),
        })
        .where("product_id", "=", product.productId)
        .where("catalog_id", "=", catalogId)
        .execute();
      updated++;
    } else {
      // Insert new product
      await tenantDb
        .insertInto("catalog_products")
        .values({
          product_id: product.productId,
          catalog_id: catalogId,
          name: product.name,
          description: product.description ?? null,
          price: product.price ?? null,
          currency: product.currency ?? "USD",
          image_urls: product.imageUrls ?? null,
          sku: product.sku ?? null,
          category: product.category ?? null,
          availability: product.availability ?? "in_stock",
          visibility: product.visibility ?? "visible",
          url: product.url ?? null,
          retailer_id: product.retailerId ?? null,
        })
        .execute();
      added++;
    }
  }

  // Remove products that no longer exist
  const toRemove = existingProducts.filter(
    (p) => !incomingProductIds.has(p.product_id),
  );
  let removed = 0;

  for (const product of toRemove) {
    await tenantDb
      .deleteFrom("catalog_products")
      .where("product_id", "=", product.product_id)
      .where("catalog_id", "=", catalogId)
      .execute();
    removed++;
  }

  // Update product count in catalog
  await tenantDb
    .updateTable("whatsapp_catalogs")
    .set({
      product_count: products.length,
      last_synced_at: new Date(),
      updated_at: new Date(),
    })
    .where("catalog_id", "=", catalogId)
    .execute();

  return {
    added,
    updated,
    removed,
    total: products.length,
  };
}

/**
 * Get catalog sync status summary
 */
export async function getCatalogSyncStatus(
  tenantDb: Kysely<TenantDatabase>,
): Promise<{
  totalCatalogs: number;
  activeCatalogs: number;
  totalProducts: number;
  lastSyncAt: Date | null;
}> {
  const [catalogsResult, activeCatalogsResult, productsResult, lastSyncResult] =
    await Promise.all([
      tenantDb
        .selectFrom("whatsapp_catalogs")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      tenantDb
        .selectFrom("whatsapp_catalogs")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("status", "=", "active")
        .executeTakeFirst(),
      tenantDb
        .selectFrom("catalog_products")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      tenantDb
        .selectFrom("whatsapp_catalogs")
        .select(["last_synced_at"])
        .orderBy("last_synced_at", "desc")
        .executeTakeFirst(),
    ]);

  return {
    totalCatalogs: Number(catalogsResult?.count ?? 0),
    activeCatalogs: Number(activeCatalogsResult?.count ?? 0),
    totalProducts: Number(productsResult?.count ?? 0),
    lastSyncAt: lastSyncResult?.last_synced_at ?? null,
  };
}

/**
 * Archive a catalog (set status to archived)
 */
export async function archiveCatalog(
  tenantDb: Kysely<TenantDatabase>,
  catalogId: string,
): Promise<{ success: boolean; error?: string }> {
  const catalog = await tenantDb
    .selectFrom("whatsapp_catalogs")
    .select(["id"])
    .where("catalog_id", "=", catalogId)
    .executeTakeFirst();

  if (!catalog) {
    return { success: false, error: "Catalog not found" };
  }

  await tenantDb
    .updateTable("whatsapp_catalogs")
    .set({
      status: "archived",
      updated_at: new Date(),
    })
    .where("catalog_id", "=", catalogId)
    .execute();

  return { success: true };
}

/**
 * Restore an archived catalog (set status to active)
 */
export async function restoreCatalog(
  tenantDb: Kysely<TenantDatabase>,
  catalogId: string,
): Promise<{ success: boolean; error?: string }> {
  const catalog = await tenantDb
    .selectFrom("whatsapp_catalogs")
    .select(["id", "status"])
    .where("catalog_id", "=", catalogId)
    .executeTakeFirst();

  if (!catalog) {
    return { success: false, error: "Catalog not found" };
  }

  if (catalog.status !== "archived") {
    return { success: false, error: "Catalog is not archived" };
  }

  await tenantDb
    .updateTable("whatsapp_catalogs")
    .set({
      status: "active",
      updated_at: new Date(),
    })
    .where("catalog_id", "=", catalogId)
    .execute();

  return { success: true };
}

/**
 * Update product visibility
 */
export async function updateProductVisibility(
  tenantDb: Kysely<TenantDatabase>,
  productId: string,
  catalogId: string,
  visibility: ProductVisibility,
): Promise<{ success: boolean; error?: string }> {
  const product = await tenantDb
    .selectFrom("catalog_products")
    .select(["id"])
    .where("product_id", "=", productId)
    .where("catalog_id", "=", catalogId)
    .executeTakeFirst();

  if (!product) {
    return { success: false, error: "Product not found" };
  }

  await tenantDb
    .updateTable("catalog_products")
    .set({
      visibility,
      updated_at: new Date(),
    })
    .where("product_id", "=", productId)
    .where("catalog_id", "=", catalogId)
    .execute();

  return { success: true };
}
