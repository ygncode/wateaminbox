/**
 * Catalogs API
 * WhatsApp Business catalog management and sync API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  WhatsAppCatalog,
  CatalogSyncStatus,
  CatalogProductsResponse,
  SyncCatalogsResponse,
  CatalogActionResponse,
  ProductVisibility,
} from "./types.js";

function withConnection(path: string, connectionId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}connectionId=${encodeURIComponent(connectionId)}`;
}

export async function getWhatsAppCatalogs(
  connectionId: string,
): Promise<WhatsAppCatalog[]> {
  return fetchWithAuth<WhatsAppCatalog[]>(
    withConnection("/catalogs", connectionId),
  );
}

export async function getCatalogSyncStatus(
  connectionId: string,
): Promise<CatalogSyncStatus> {
  return fetchWithAuth<CatalogSyncStatus>(
    withConnection("/catalogs/status", connectionId),
  );
}

export async function getWhatsAppCatalog(
  catalogId: string,
  connectionId: string,
): Promise<WhatsAppCatalog> {
  return fetchWithAuth<WhatsAppCatalog>(
    withConnection(`/catalogs/${catalogId}`, connectionId),
  );
}

export async function getCatalogProducts(
  catalogId: string,
  connectionId: string,
): Promise<CatalogProductsResponse> {
  return fetchWithAuth<CatalogProductsResponse>(
    withConnection(`/catalogs/${catalogId}/products`, connectionId),
  );
}

export async function triggerCatalogSync(
  connectionId: string,
): Promise<SyncCatalogsResponse> {
  return fetchWithAuth<SyncCatalogsResponse>(
    withConnection("/catalogs/sync", connectionId),
    {
      method: "POST",
    },
  );
}

export async function triggerCatalogProductsSync(
  catalogId: string,
  connectionId: string,
): Promise<SyncCatalogsResponse> {
  return fetchWithAuth<SyncCatalogsResponse>(
    withConnection(`/catalogs/${catalogId}/sync-products`, connectionId),
    {
      method: "POST",
    },
  );
}

export async function archiveCatalog(
  catalogId: string,
  connectionId: string,
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    withConnection(`/catalogs/${catalogId}/archive`, connectionId),
    {
      method: "POST",
    },
  );
}

export async function restoreCatalog(
  catalogId: string,
  connectionId: string,
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    withConnection(`/catalogs/${catalogId}/restore`, connectionId),
    {
      method: "POST",
    },
  );
}

export async function updateProductVisibility(
  catalogId: string,
  productId: string,
  visibility: ProductVisibility,
  connectionId: string,
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    withConnection(
      `/catalogs/${catalogId}/products/${productId}/visibility`,
      connectionId,
    ),
    {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    },
  );
}
