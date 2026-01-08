/**
 * Catalogs API
 * WhatsApp Business catalog management and sync API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  WhatsAppCatalog,
  CatalogSyncStatus,
  CatalogProductsResponse,
  CatalogListResponse,
  SyncCatalogsResponse,
  CatalogActionResponse,
  ProductVisibility,
} from "./types.js";

export async function getWhatsAppCatalogs(): Promise<WhatsAppCatalog[]> {
  const response = await fetchWithAuth<CatalogListResponse>("/catalogs");
  return response.data;
}

export async function getCatalogSyncStatus(): Promise<CatalogSyncStatus> {
  return fetchWithAuth<CatalogSyncStatus>("/catalogs/status");
}

export async function getWhatsAppCatalog(
  catalogId: string,
): Promise<WhatsAppCatalog> {
  return fetchWithAuth<WhatsAppCatalog>(`/catalogs/${catalogId}`);
}

export async function getCatalogProducts(
  catalogId: string,
): Promise<CatalogProductsResponse> {
  return fetchWithAuth<CatalogProductsResponse>(
    `/catalogs/${catalogId}/products`,
  );
}

export async function triggerCatalogSync(): Promise<SyncCatalogsResponse> {
  return fetchWithAuth<SyncCatalogsResponse>("/catalogs/sync", {
    method: "POST",
  });
}

export async function triggerCatalogProductsSync(
  catalogId: string,
): Promise<SyncCatalogsResponse> {
  return fetchWithAuth<SyncCatalogsResponse>(
    `/catalogs/${catalogId}/sync-products`,
    {
      method: "POST",
    },
  );
}

export async function archiveCatalog(
  catalogId: string,
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    `/catalogs/${catalogId}/archive`,
    {
      method: "POST",
    },
  );
}

export async function restoreCatalog(
  catalogId: string,
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    `/catalogs/${catalogId}/restore`,
    {
      method: "POST",
    },
  );
}

export async function updateProductVisibility(
  catalogId: string,
  productId: string,
  visibility: ProductVisibility,
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    `/catalogs/${catalogId}/products/${productId}/visibility`,
    {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    },
  );
}
