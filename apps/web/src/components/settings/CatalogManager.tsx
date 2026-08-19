import { formatStatusTime } from "@wateaminbox/shared";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Package,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useWhatsAppAccountScope,
  WhatsAppAccountScope,
} from "@/components/settings/WhatsAppAccountScope";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CatalogProduct, WhatsAppCatalog } from "@/hooks/useCatalogs";
import {
  useCatalogProducts,
  useCatalogs,
  useTriggerCatalogProductsSync,
  useUpdateProductVisibility,
} from "@/hooks/useCatalogs";
import { cn } from "@/lib/utils";

/**
 * WhatsApp Business Catalogs Manager Component
 * Allows users to view and manage WhatsApp Business product catalogs
 */
export function CatalogManager() {
  const { t } = useTranslation();
  const [selectedCatalog, setSelectedCatalog] =
    useState<WhatsAppCatalog | null>(null);
  const [productsDialogOpen, setProductsDialogOpen] = useState(false);
  const [pendingCatalogId, setPendingCatalogId] = useState<string | null>(null);
  const accountScope = useWhatsAppAccountScope();
  const { connectionId, selectedConnection } = accountScope;

  useEffect(() => {
    setProductsDialogOpen(false);
    setSelectedCatalog(null);
  }, [connectionId]);

  const {
    catalogs,
    status,
    isLoading,
    error,
    sync,
    archive,
    restore,
    isSyncing,
    isArchiving,
    isRestoring,
  } = useCatalogs(connectionId);

  const handleSync = async () => {
    try {
      await sync();
      toast.success(t("catalogs.syncStarted", "Catalog sync started"), {
        description: t("catalogs.syncStartedDescription", {
          defaultValue: "Refreshing catalogs for {{account}}.",
          account:
            selectedConnection?.name ??
            t("catalogs.thisAccount", "this account"),
        }),
      });
    } catch (err) {
      toast.error(t("catalogs.syncFailed", "Could not sync catalogs"), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleArchive = async (catalogId: string) => {
    setPendingCatalogId(catalogId);
    try {
      await archive(catalogId);
      toast.success(t("catalogs.archivedToast", "Catalog archived"));
    } catch (err) {
      toast.error(t("catalogs.archiveFailed", "Could not archive catalog"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPendingCatalogId(null);
    }
  };

  const handleRestore = async (catalogId: string) => {
    setPendingCatalogId(catalogId);
    try {
      await restore(catalogId);
      toast.success(t("catalogs.restored", "Catalog restored"));
    } catch (err) {
      toast.error(t("catalogs.restoreFailed", "Could not restore catalog"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPendingCatalogId(null);
    }
  };

  const openProductsDialog = (catalog: WhatsAppCatalog) => {
    setSelectedCatalog(catalog);
    setProductsDialogOpen(true);
  };

  const formatLastSync = (dateString: string | null) => {
    if (!dateString) return t("catalogs.neverSynced", "Never synced");
    return formatStatusTime(dateString, t);
  };

  const formatCurrency = (price: number | null, currency: string) => {
    if (price === null) return "-";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(price);
  };

  return (
    <div className="space-y-6">
      <WhatsAppAccountScope
        connections={accountScope.connections}
        connectionId={connectionId}
        onConnectionChange={accountScope.setConnectionId}
        isLoading={accountScope.isLoading}
      />

      {(error || accountScope.isError) && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("catalogs.errors.loadFailed", "Failed to load catalogs")}
          </span>
        </div>
      )}

      {/* Status summary */}
      {status && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              value: status.totalCatalogs,
              label: t("catalogs.stats.totalCatalogs", "Catalogs"),
            },
            {
              value: status.activeCatalogs,
              label: t("catalogs.stats.active", "Active"),
              active: true,
            },
            {
              value: status.totalProducts,
              label: t("catalogs.stats.totalProducts", "Products"),
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-[#e2e8e3] bg-[#f8faf8] p-3.5 dark:border-white/[0.07] dark:bg-white/[0.025]"
            >
              <dd
                className={cn(
                  "text-xl font-semibold tabular-nums text-[#10211b] dark:text-dark-text-primary",
                  item.active && "text-[#087a5c] dark:text-emerald-300",
                )}
              >
                {item.value}
              </dd>
              <dt className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
                {item.label}
              </dt>
            </div>
          ))}
          <div className="rounded-xl border border-[#e2e8e3] bg-[#f8faf8] p-3.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
            <dd className="flex h-6 items-center gap-1.5 text-xs font-medium text-[#315348] dark:text-[#c9d8d2]">
              <Clock className="h-3.5 w-3.5 text-[#829089]" />
              {formatLastSync(status.lastSyncAt)}
            </dd>
            <dt className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
              {t("catalogs.lastSync", "Last sync")}
            </dt>
          </div>
        </dl>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleSync}
          disabled={
            isSyncing ||
            !connectionId ||
            selectedConnection?.status !== "connected"
          }
          variant="outline"
          className="gap-2"
          data-testid="sync-catalogs-button"
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("catalogs.syncFromWhatsApp", "Sync Catalogs")}
        </Button>
      </div>

      {/* Catalogs List */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-[#e2e8e3] bg-[#f8faf8] py-10 dark:border-white/[0.07] dark:bg-white/[0.025]">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-dark-text-tertiary" />
        </div>
      ) : catalogs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d6dfd9] bg-[#f8faf8] px-5 py-10 text-center text-gray-500 dark:border-white/[0.1] dark:bg-white/[0.025] dark:text-dark-text-secondary">
          <ShoppingBag className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-dark-text-tertiary" />
          <p className="font-medium">
            {t("catalogs.empty", "No catalogs found")}
          </p>
          <p className="text-sm mt-1">
            {t(
              "catalogs.emptyHint",
              "Create catalogs in WhatsApp Business and click 'Sync Catalogs' to import them",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="catalogs-list">
          {catalogs.map((catalog) => (
            <div
              key={catalog.id}
              className="group flex items-center gap-3 rounded-xl border border-[#e2e8e3] bg-[#fbfcfb] p-3.5 transition-colors hover:border-[#c8d3cc] hover:bg-[#f8faf8] dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.04]"
              data-testid={`catalog-item-${catalog.catalogId}`}
            >
              {/* Catalog icon/image */}
              <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                {catalog.headerImageUrl ? (
                  <img
                    src={catalog.headerImageUrl}
                    alt={catalog.name}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                ) : (
                  <ShoppingBag className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                )}
              </div>

              {/* Catalog info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate flex-1 min-w-0">
                    {catalog.name}
                  </p>
                  {catalog.status === "archived" && (
                    <span className="text-xs bg-gray-100 dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary px-1.5 py-0.5 rounded flex-shrink-0">
                      {t("catalogs.archived", "Archived")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-dark-text-secondary mt-0.5">
                  <span className="flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    {catalog.productCount} {t("catalogs.products", "products")}
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {catalog.currency}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex-shrink-0 flex items-center gap-1">
                {catalog.status === "archived" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(catalog.catalogId)}
                    disabled={isRestoring}
                    className="gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-green-600 dark:hover:text-green-400"
                    data-testid={`restore-catalog-${catalog.catalogId}`}
                  >
                    {isRestoring && pendingCatalogId === catalog.catalogId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArchiveRestore className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">
                      {t("catalogs.restore", "Restore")}
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleArchive(catalog.catalogId)}
                    disabled={isArchiving}
                    className="gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-yellow-600 dark:hover:text-yellow-400"
                    data-testid={`archive-catalog-${catalog.catalogId}`}
                  >
                    {isArchiving && pendingCatalogId === catalog.catalogId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">
                      {t("catalogs.archive", "Archive")}
                    </span>
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openProductsDialog(catalog)}
                  className="gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-blue-600 dark:hover:text-blue-400"
                  data-testid={`view-products-${catalog.catalogId}`}
                >
                  <ChevronRight className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t("catalogs.viewProducts", "View")}
                  </span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Products Dialog */}
      <ProductsDialog
        catalog={selectedCatalog}
        open={productsDialogOpen}
        onOpenChange={setProductsDialogOpen}
        formatCurrency={formatCurrency}
        connectionId={connectionId}
      />
    </div>
  );
}

/**
 * Products Dialog Component
 * Displays products for a selected catalog
 */
function ProductsDialog({
  catalog,
  open,
  onOpenChange,
  formatCurrency,
  connectionId,
}: {
  catalog: WhatsAppCatalog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatCurrency: (price: number | null, currency: string) => string;
  connectionId: string;
}) {
  const { t } = useTranslation();
  const {
    data: productsData,
    isLoading,
    error,
  } = useCatalogProducts(catalog?.catalogId || "", connectionId);
  const syncMutation = useTriggerCatalogProductsSync();

  const products = productsData?.products || [];

  const handleSyncProducts = async () => {
    if (!catalog) return;
    try {
      await syncMutation.mutateAsync({
        catalogId: catalog.catalogId,
        connectionId,
      });
      toast.success(t("catalogs.productSyncStarted", "Product sync started"));
    } catch (err) {
      toast.error(t("catalogs.productSyncFailed", "Could not sync products"), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            {catalog?.name || t("catalogs.products", "Products")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "catalogs.productsDescription",
              "Products in this catalog from WhatsApp Business.",
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Sync button */}
        <div className="flex justify-end mb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncProducts}
            disabled={syncMutation.isPending || !connectionId}
            className="gap-2"
            data-testid="sync-products-button"
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("catalogs.syncProducts", "Sync Products")}
          </Button>
        </div>

        {/* Products list */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              {t(
                "catalogs.errors.loadProductsFailed",
                "Failed to load products",
              )}
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-dark-text-tertiary" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-dark-text-secondary">
              <Package className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-dark-text-tertiary" />
              <p className="font-medium">
                {t("catalogs.noProducts", "No products found")}
              </p>
              <p className="text-sm mt-1">
                {t(
                  "catalogs.noProductsHint",
                  "Add products to this catalog in WhatsApp Business",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="products-list">
              {products.map((product) => (
                <ProductItem
                  key={product.id}
                  product={product}
                  formatCurrency={formatCurrency}
                  catalogId={catalog?.catalogId ?? ""}
                  connectionId={connectionId}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Product Item Component
 * Displays a single product in the products list
 */
function ProductItem({
  product,
  formatCurrency,
  catalogId,
  connectionId,
}: {
  product: CatalogProduct;
  formatCurrency: (price: number | null, currency: string) => string;
  catalogId: string;
  connectionId: string;
}) {
  const { t } = useTranslation();
  const imageUrl = product.imageUrls?.[0];
  const visibilityMutation = useUpdateProductVisibility();
  const nextVisibility = product.visibility === "hidden" ? "visible" : "hidden";

  const handleVisibilityChange = async () => {
    try {
      await visibilityMutation.mutateAsync({
        catalogId,
        productId: product.productId,
        visibility: nextVisibility,
        connectionId,
      });
      toast.success(
        nextVisibility === "visible"
          ? t("catalogs.productShown", "Product shown")
          : t("catalogs.productHidden", "Product hidden"),
      );
    } catch (err) {
      toast.error(
        t(
          "catalogs.visibilityUpdateFailed",
          "Could not update product visibility",
        ),
        {
          description: err instanceof Error ? err.message : undefined,
        },
      );
    }
  };

  return (
    <div
      className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors"
      data-testid={`product-item-${product.productId}`}
    >
      {/* Product image */}
      <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-dark-tertiary flex items-center justify-center flex-shrink-0 overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="w-12 h-12 object-cover"
          />
        ) : (
          <ImageIcon className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
        )}
      </div>

      {/* Product info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate text-sm">
          {product.name}
        </p>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-dark-text-secondary mt-0.5">
          <span className="font-medium text-gray-700 dark:text-dark-text-primary">
            {formatCurrency(product.price, product.currency)}
          </span>
          {product.sku && (
            <span className="text-gray-400 dark:text-dark-text-tertiary">
              SKU: {product.sku}
            </span>
          )}
        </div>
        {product.category && (
          <span className="inline-block text-xs bg-gray-100 dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary px-1.5 py-0.5 rounded mt-1">
            {product.category}
          </span>
        )}
      </div>

      {/* Visibility indicator */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleVisibilityChange}
        disabled={visibilityMutation.isPending}
        className="h-8 shrink-0 gap-1.5 px-2 text-xs"
        aria-label={`${nextVisibility === "visible" ? "Show" : "Hide"} ${product.name}`}
      >
        {visibilityMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : product.visibility === "hidden" ? (
          <>
            <EyeOff className="h-4 w-4 text-gray-400" />
            <span className="hidden sm:inline">
              {t("catalogs.hidden", "Hidden")}
            </span>
          </>
        ) : (
          <>
            <Eye className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="hidden sm:inline">
              {t("catalogs.visible", "Visible")}
            </span>
          </>
        )}
      </Button>
    </div>
  );
}

export default CatalogManager;
