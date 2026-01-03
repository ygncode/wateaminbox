import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWhatsAppCatalogs,
  getCatalogSyncStatus,
  getWhatsAppCatalog,
  getCatalogProducts,
  triggerCatalogSync,
  triggerCatalogProductsSync,
  archiveCatalog,
  restoreCatalog,
  updateProductVisibility,
  type WhatsAppCatalog,
  type CatalogProduct,
  type CatalogSyncStatus,
  type ProductVisibility,
} from '@/lib/api'

// Query keys for catalogs
export const catalogKeys = {
  all: ['catalogs'] as const,
  list: () => [...catalogKeys.all, 'list'] as const,
  status: () => [...catalogKeys.all, 'status'] as const,
  detail: (catalogId: string) => [...catalogKeys.all, 'detail', catalogId] as const,
  products: (catalogId: string) => [...catalogKeys.all, 'products', catalogId] as const,
}

/**
 * Hook for fetching WhatsApp Business catalogs
 */
export function useWhatsAppCatalogs() {
  return useQuery({
    queryKey: catalogKeys.list(),
    queryFn: getWhatsAppCatalogs,
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Hook for fetching catalog sync status
 */
export function useCatalogSyncStatus() {
  return useQuery({
    queryKey: catalogKeys.status(),
    queryFn: getCatalogSyncStatus,
    staleTime: 30 * 1000, // 30 seconds
  })
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
  })
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
  })
}

/**
 * Hook for triggering a catalog sync from WhatsApp Business
 */
export function useTriggerCatalogSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: triggerCatalogSync,
    onSuccess: () => {
      // Invalidate catalogs and status to refresh after sync completes
      queryClient.invalidateQueries({ queryKey: catalogKeys.all })
    },
  })
}

/**
 * Hook for triggering a product sync for a specific catalog
 */
export function useTriggerCatalogProductsSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (catalogId: string) => triggerCatalogProductsSync(catalogId),
    onSuccess: (_, catalogId) => {
      // Invalidate products for the specific catalog
      queryClient.invalidateQueries({ queryKey: catalogKeys.products(catalogId) })
      queryClient.invalidateQueries({ queryKey: catalogKeys.detail(catalogId) })
    },
  })
}

/**
 * Hook for archiving a catalog
 */
export function useArchiveCatalog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (catalogId: string) => archiveCatalog(catalogId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.all })
    },
  })
}

/**
 * Hook for restoring an archived catalog
 */
export function useRestoreCatalog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (catalogId: string) => restoreCatalog(catalogId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.all })
    },
  })
}

/**
 * Hook for updating product visibility
 */
export function useUpdateProductVisibility() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      catalogId,
      productId,
      visibility,
    }: {
      catalogId: string
      productId: string
      visibility: ProductVisibility
    }) => updateProductVisibility(catalogId, productId, visibility),
    onSuccess: (_, { catalogId }) => {
      // Invalidate products for the specific catalog
      queryClient.invalidateQueries({ queryKey: catalogKeys.products(catalogId) })
    },
  })
}

/**
 * Combined hook for catalog management
 */
export function useCatalogs() {
  const queryClient = useQueryClient()

  const catalogsQuery = useWhatsAppCatalogs()
  const statusQuery = useCatalogSyncStatus()

  const syncMutation = useTriggerCatalogSync()
  const archiveMutation = useArchiveCatalog()
  const restoreMutation = useRestoreCatalog()

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
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.all })
    },

    // Mutation states
    isSyncing: syncMutation.isPending,
    isArchiving: archiveMutation.isPending,
    isRestoring: restoreMutation.isPending,
  }
}

// Type exports
export type { WhatsAppCatalog, CatalogProduct, CatalogSyncStatus, ProductVisibility }
