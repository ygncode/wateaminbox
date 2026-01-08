import { useMutation, useQuery } from "@tanstack/react-query";
import {
  archiveCatalog,
  type CatalogProduct,
  type CatalogSyncStatus,
  getCatalogProducts,
  getCatalogSyncStatus,
  getWhatsAppCatalog,
  getWhatsAppCatalogs,
  type ProductVisibility,
  restoreCatalog,
  triggerCatalogProductsSync,
  triggerCatalogSync,
  updateProductVisibility,
  type WhatsAppCatalog,
} from "@/lib/api";
import { useInvalidate, useQueryInvalidation } from "./query";

// Query keys for catalogs
export const catalogKeys = {
  all: ["catalogs"] as const,
  list: () => [...catalogKeys.all, "list"] as const,
  status: () => [...catalogKeys.all, "status"] as const,
  detail: (catalogId: string) =>
    [...catalogKeys.all, "detail", catalogId] as const,
  products: (catalogId: string) =>
    [...catalogKeys.all, "products", catalogId] as const,
};

/**
 * Hook for fetching WhatsApp Business catalogs
 */
export function useWhatsAppCatalogs() {
  return useQuery({
    queryKey: catalogKeys.list(),
    queryFn: getWhatsAppCatalogs,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for fetching catalog sync status
 */
export function useCatalogSyncStatus() {
  return useQuery({
    queryKey: catalogKeys.status(),
    queryFn: getCatalogSyncStatus,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook for fetching a specific catalog
 */
export function useWhatsAppCatalog(catalogId: string) {
  return useQuery({
    queryKey: catalogKeys.detail(catalogId),
    queryFn: () => getWhatsAppCatalog(catalogId),
    staleTime: 60 * 1000, // 1 minute
    enabled: !!catalogId,
  });
}

/**
 * Hook for fetching products for a specific catalog
 */
export function useCatalogProducts(catalogId: string) {
  return useQuery({
    queryKey: catalogKeys.products(catalogId),
    queryFn: () => getCatalogProducts(catalogId),
    staleTime: 60 * 1000, // 1 minute
    enabled: !!catalogId,
  });
}

/**
 * Hook for triggering a catalog sync from WhatsApp Business
 */
export function useTriggerCatalogSync() {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  return useMutation({
    mutationFn: triggerCatalogSync,
    onSuccess: invalidateCatalogs,
  });
}

/**
 * Hook for triggering a product sync for a specific catalog
 */
export function useTriggerCatalogProductsSync() {
  const { invalidateMultiple } = useQueryInvalidation();

  return useMutation({
    mutationFn: (catalogId: string) => triggerCatalogProductsSync(catalogId),
    onSuccess: (_, catalogId) => {
      invalidateMultiple([
        catalogKeys.products(catalogId),
        catalogKeys.detail(catalogId),
      ]);
    },
  });
}

/**
 * Hook for archiving a catalog
 */
export function useArchiveCatalog() {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  return useMutation({
    mutationFn: (catalogId: string) => archiveCatalog(catalogId),
    onSuccess: invalidateCatalogs,
  });
}

/**
 * Hook for restoring an archived catalog
 */
export function useRestoreCatalog() {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  return useMutation({
    mutationFn: (catalogId: string) => restoreCatalog(catalogId),
    onSuccess: invalidateCatalogs,
  });
}

/**
 * Hook for updating product visibility
 */
export function useUpdateProductVisibility() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: ({
      catalogId,
      productId,
      visibility,
    }: {
      catalogId: string;
      productId: string;
      visibility: ProductVisibility;
    }) => updateProductVisibility(catalogId, productId, visibility),
    onSuccess: (_, { catalogId }) => {
      invalidate(catalogKeys.products(catalogId));
    },
  });
}

/**
 * Combined hook for catalog management
 */
export function useCatalogs() {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  const catalogsQuery = useWhatsAppCatalogs();
  const statusQuery = useCatalogSyncStatus();

  const syncMutation = useTriggerCatalogSync();
  const archiveMutation = useArchiveCatalog();
  const restoreMutation = useRestoreCatalog();

  return {
    // Data
    catalogs: catalogsQuery.data || [],
    status: statusQuery.data,

    // Loading states
    isLoading: catalogsQuery.isLoading || statusQuery.isLoading,
    isCatalogsLoading: catalogsQuery.isLoading,
    isStatusLoading: statusQuery.isLoading,

    // Errors
    error: catalogsQuery.error || statusQuery.error,

    // Actions
    sync: () => syncMutation.mutateAsync(undefined),
    archive: (catalogId: string) => archiveMutation.mutateAsync(catalogId),
    restore: (catalogId: string) => restoreMutation.mutateAsync(catalogId),
    refresh: invalidateCatalogs,

    // Mutation states
    isSyncing: syncMutation.isPending,
    isArchiving: archiveMutation.isPending,
    isRestoring: restoreMutation.isPending,
  };
}

// Type exports
export type {
  WhatsAppCatalog,
  CatalogProduct,
  CatalogSyncStatus,
  ProductVisibility,
};
