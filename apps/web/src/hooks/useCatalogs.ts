import { useMutation, useQuery } from "@tanstack/react-query";
import {
  archiveCatalog,
  getCatalogProducts,
  getCatalogSyncStatus,
  getWhatsAppCatalog,
  getWhatsAppCatalogs,
  restoreCatalog,
  triggerCatalogProductsSync,
  triggerCatalogSync,
  updateProductVisibility,
} from "@/lib/api/catalogs";
import { getCompanyId } from "@/lib/api/client";
import type {
  CatalogProduct,
  CatalogSyncStatus,
  ProductVisibility,
  WhatsAppCatalog,
} from "@/lib/api/types";
import { useInvalidate, useQueryInvalidation } from "./query";

// Query keys for catalogs
export const catalogKeys = {
  get all() {
    return ["catalogs", getCompanyId()] as const;
  },
  list: (connectionId: string) =>
    ["catalogs", getCompanyId(), connectionId, "list"] as const,
  status: (connectionId: string) =>
    ["catalogs", getCompanyId(), connectionId, "status"] as const,
  detail: (connectionId: string, catalogId: string) =>
    ["catalogs", getCompanyId(), connectionId, "detail", catalogId] as const,
  products: (connectionId: string, catalogId: string) =>
    ["catalogs", getCompanyId(), connectionId, "products", catalogId] as const,
};

/**
 * Hook for fetching WhatsApp Business catalogs
 */
export function useWhatsAppCatalogs(connectionId: string) {
  return useQuery({
    queryKey: catalogKeys.list(connectionId),
    queryFn: () => getWhatsAppCatalogs(connectionId),
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!connectionId,
  });
}

/**
 * Hook for fetching catalog sync status
 */
export function useCatalogSyncStatus(connectionId: string) {
  return useQuery({
    queryKey: catalogKeys.status(connectionId),
    queryFn: () => getCatalogSyncStatus(connectionId),
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!connectionId,
  });
}

/**
 * Hook for fetching a specific catalog
 */
export function useWhatsAppCatalog(catalogId: string, connectionId: string) {
  return useQuery({
    queryKey: catalogKeys.detail(connectionId, catalogId),
    queryFn: () => getWhatsAppCatalog(catalogId, connectionId),
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!catalogId && !!connectionId,
  });
}

/**
 * Hook for fetching products for a specific catalog
 */
export function useCatalogProducts(catalogId: string, connectionId: string) {
  return useQuery({
    queryKey: catalogKeys.products(connectionId, catalogId),
    queryFn: () => getCatalogProducts(catalogId, connectionId),
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!catalogId && !!connectionId,
  });
}

/**
 * Hook for triggering a catalog sync from WhatsApp Business
 */
export function useTriggerCatalogSync() {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  return useMutation({
    mutationFn: (connectionId: string) => triggerCatalogSync(connectionId),
    onSuccess: invalidateCatalogs,
  });
}

/**
 * Hook for triggering a product sync for a specific catalog
 */
export function useTriggerCatalogProductsSync() {
  const { invalidateMultiple } = useQueryInvalidation();

  return useMutation({
    mutationFn: ({
      catalogId,
      connectionId,
    }: {
      catalogId: string;
      connectionId: string;
    }) => triggerCatalogProductsSync(catalogId, connectionId),
    onSuccess: (_, { catalogId, connectionId }) => {
      invalidateMultiple([
        catalogKeys.products(connectionId, catalogId),
        catalogKeys.detail(connectionId, catalogId),
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
    mutationFn: ({
      catalogId,
      connectionId,
    }: {
      catalogId: string;
      connectionId: string;
    }) => archiveCatalog(catalogId, connectionId),
    onSuccess: invalidateCatalogs,
  });
}

/**
 * Hook for restoring an archived catalog
 */
export function useRestoreCatalog() {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  return useMutation({
    mutationFn: ({
      catalogId,
      connectionId,
    }: {
      catalogId: string;
      connectionId: string;
    }) => restoreCatalog(catalogId, connectionId),
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
      connectionId,
    }: {
      catalogId: string;
      productId: string;
      visibility: ProductVisibility;
      connectionId: string;
    }) =>
      updateProductVisibility(catalogId, productId, visibility, connectionId),
    onSuccess: (_, { catalogId, connectionId }) => {
      invalidate(catalogKeys.products(connectionId, catalogId));
    },
  });
}

/**
 * Combined hook for catalog management
 */
export function useCatalogs(connectionId: string) {
  const invalidateCatalogs = useInvalidate(catalogKeys.all);

  const catalogsQuery = useWhatsAppCatalogs(connectionId);
  const statusQuery = useCatalogSyncStatus(connectionId);

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
    sync: () => syncMutation.mutateAsync(connectionId),
    archive: (catalogId: string) =>
      archiveMutation.mutateAsync({ catalogId, connectionId }),
    restore: (catalogId: string) =>
      restoreMutation.mutateAsync({ catalogId, connectionId }),
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
