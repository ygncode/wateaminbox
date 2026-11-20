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
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useWhatsAppAccountScope,
  WhatsAppAccountScope,
} from "@/components/settings/WhatsAppAccountScope";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EllipsisMenu,
  type EllipsisMenuItem,
} from "@/components/ui/ellipsis-menu";
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
  const [catalogToArchive, setCatalogToArchive] =
    useState<WhatsAppCatalog | null>(null);
  const accountScope = useWhatsAppAccountScope();
  const { connectionId, selectedConnection } = accountScope;

  useEffect(() => {
    setProductsDialogOpen(false);
    setSelectedCatalog(null);
    setCatalogToArchive(null);
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
      setCatalogToArchive(null);
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

  const activeCatalogs = catalogs.filter(
    (catalog) => catalog.status !== "archived",
  );
  const archivedCatalogs = catalogs.filter(
    (catalog) => catalog.status === "archived",
  );

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
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
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
              className="rounded-xl border border-line bg-subtle p-3.5"
            >
              <dd
                className={cn(
                  "text-xl font-semibold tabular-nums text-fg",
                  item.active && "text-accent",
                )}
              >
                {item.value}
              </dd>
              <dt className="mt-1 text-xs text-fg-muted">{item.label}</dt>
            </div>
          ))}
          <div className="rounded-xl border border-line bg-subtle p-3.5">
            <dd className="flex h-6 items-center gap-1.5 text-xs font-medium text-accent">
              <Clock className="h-3.5 w-3.5 text-fg-muted" />
              {formatLastSync(status.lastSyncAt)}
            </dd>
            <dt className="mt-1 text-xs text-fg-muted">
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
        <div className="flex items-center justify-center rounded-xl border border-line bg-subtle py-10">
          <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" />
        </div>
      ) : catalogs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-subtle px-5 py-10 text-center text-fg-muted">
          <ShoppingBag className="h-12 w-12 mx-auto mb-3 text-fg-subtle" />
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
        <div className="space-y-6" data-testid="catalogs-list">
          {activeCatalogs.length > 0 && (
            <CatalogSection
              title={t("catalogs.availableCatalogs", "Available catalogs")}
              description={t(
                "catalogs.availableCatalogsDescription",
                "Synced and ready for your team.",
              )}
              count={activeCatalogs.length}
            >
              {activeCatalogs.map((catalog) => (
                <CatalogCard
                  key={catalog.id}
                  catalog={catalog}
                  isArchiving={isArchiving}
                  isRestoring={isRestoring}
                  isPending={pendingCatalogId === catalog.catalogId}
                  onArchive={() => setCatalogToArchive(catalog)}
                  onRestore={() => handleRestore(catalog.catalogId)}
                  onView={() => openProductsDialog(catalog)}
                />
              ))}
            </CatalogSection>
          )}

          {archivedCatalogs.length > 0 && (
            <CatalogSection
              title={t("catalogs.archivedCatalogs", "Archived catalogs")}
              description={t(
                "catalogs.archivedCatalogsDescription",
                "Out of the active list, but available whenever you need them.",
              )}
              count={archivedCatalogs.length}
              archived
            >
              {archivedCatalogs.map((catalog) => (
                <CatalogCard
                  key={catalog.id}
                  catalog={catalog}
                  isArchiving={isArchiving}
                  isRestoring={isRestoring}
                  isPending={pendingCatalogId === catalog.catalogId}
                  onArchive={() => setCatalogToArchive(catalog)}
                  onRestore={() => handleRestore(catalog.catalogId)}
                  onView={() => openProductsDialog(catalog)}
                />
              ))}
            </CatalogSection>
          )}
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

      <ConfirmationDialog
        open={catalogToArchive !== null}
        onOpenChange={(open) => {
          if (!open && !isArchiving) setCatalogToArchive(null);
        }}
        title={t("catalogs.archiveConfirmTitle", "Archive this catalog?")}
        description={t("catalogs.archiveConfirmDescription", {
          defaultValue:
            "{{name}} will move out of the active catalog list. You can restore it at any time.",
          name: catalogToArchive?.name ?? "",
        })}
        confirmText={t("catalogs.archiveCatalog", "Archive catalog")}
        onConfirm={() =>
          catalogToArchive
            ? handleArchive(catalogToArchive.catalogId)
            : undefined
        }
        isLoading={isArchiving}
        confirmTestId="confirm-archive-catalog"
      />
    </div>
  );
}

function CatalogSection({
  title,
  description,
  count,
  archived = false,
  children,
}: {
  title: string;
  description: string;
  count: number;
  archived?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2.5 flex items-end justify-between gap-4 px-0.5">
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
        </div>
        <span
          className={cn(
            "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums",
            archived
              ? "bg-warning-soft text-fg-muted"
              : "bg-accent-soft text-accent",
          )}
        >
          {count}
        </span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function CatalogCard({
  catalog,
  isArchiving,
  isRestoring,
  isPending,
  onArchive,
  onRestore,
  onView,
}: {
  catalog: WhatsAppCatalog;
  isArchiving: boolean;
  isRestoring: boolean;
  isPending: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const isArchived = catalog.status === "archived";
  const menuItems: EllipsisMenuItem[] = [
    {
      id: "archive",
      label: t("catalogs.archiveCatalog", "Archive catalog"),
      icon: Archive,
      disabled: isArchiving || isRestoring,
      onClick: onArchive,
    },
  ];

  return (
    <article
      className={cn(
        "relative overflow-visible rounded-2xl border p-4 transition-all duration-200 sm:p-5",
        isArchived
          ? "border-line bg-subtle"
          : "border-line bg-subtle shadow-xs hover:-translate-y-px hover:border-line-strong hover:shadow-lg",
      )}
      data-testid={`catalog-item-${catalog.catalogId}`}
    >
      {isArchived && (
        <span
          aria-hidden="true"
          className="absolute inset-y-4 start-0 w-1 rounded-e-full bg-warning"
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div
            className={cn(
              "grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border",
              isArchived
                ? "border-warning/30 bg-warning-soft text-warning"
                : "border-warning/30 bg-warning-soft text-warning",
            )}
          >
            {catalog.headerImageUrl ? (
              <img
                src={catalog.headerImageUrl}
                alt=""
                className={cn(
                  "h-full w-full object-cover",
                  isArchived && "grayscale-[35%]",
                )}
              />
            ) : isArchived ? (
              <Archive className="h-5 w-5" />
            ) : (
              <ShoppingBag className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <h4 className="truncate text-[15px] font-semibold text-fg">
              {catalog.name}
            </h4>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                {t("catalogs.productCount", {
                  count: catalog.productCount,
                  defaultValue: `${catalog.productCount} products`,
                })}
              </span>
              <span
                aria-hidden="true"
                className="h-1 w-1 rounded-full bg-current opacity-40"
              />
              <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wide">
                <DollarSign className="h-3.5 w-3.5" />
                {catalog.currency}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 sm:mt-0 sm:shrink-0 sm:border-0 sm:pt-0">
          {isArchived && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestore}
              disabled={isRestoring || isArchiving}
              className="flex-1 gap-1.5 border-line-strong bg-subtle text-accent shadow-none hover:border-line-strong hover:bg-accent-soft hover:text-accent sm:flex-none"
              data-testid={`restore-catalog-${catalog.catalogId}`}
            >
              {isRestoring && isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArchiveRestore className="h-4 w-4" />
              )}
              {t("catalogs.restoreCatalog", "Restore catalog")}
            </Button>
          )}

          <Button
            variant={isArchived ? "ghost" : "outline"}
            size="sm"
            onClick={onView}
            className={cn(
              "flex-1 gap-1.5 sm:flex-none",
              isArchived
                ? "text-fg-muted hover:bg-warning-soft"
                : "border-line bg-surface text-accent shadow-none hover:border-line-strong hover:bg-muted hover:text-accent",
            )}
            data-testid={`view-products-${catalog.catalogId}`}
          >
            {t("catalogs.viewProducts", "View products")}
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
          </Button>

          {!isArchived && (
            <EllipsisMenu
              items={menuItems}
              size="default"
              ariaLabel={t("catalogs.catalogActions", {
                defaultValue: "Actions for {{name}}",
                name: catalog.name,
              })}
              triggerClassName="text-fg-muted hover:bg-muted"
            />
          )}
        </div>
      </div>
    </article>
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
      <DialogContent className="mx-3 flex max-h-[min(88dvh,760px)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border-line p-0 shadow-lg sm:w-full [&>button]:end-4 [&>button]:top-4 [&>button]:grid [&>button]:h-8 [&>button]:w-8 [&>button]:place-items-center [&>button]:rounded-full [&>button]:border [&>button]:border-line [&>button]:bg-surface [&>button]:opacity-100 [&>button]:shadow-sm hover:[&>button]:bg-muted">
        <div className="border-b border-line bg-subtle px-5 py-5 pe-14 sm:px-6 sm:py-6 sm:pe-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <DialogHeader className="min-w-0 space-y-0 text-start">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-warning/30 bg-warning-soft text-warning">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-lg leading-tight sm:text-xl">
                    {catalog?.name || t("catalogs.productsTitle", "Products")}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {t(
                      "catalogs.productsDescription",
                      "Synced from WhatsApp Business.",
                    )}
                  </DialogDescription>
                </div>
              </div>
              {catalog && (
                <div className="ms-14 mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span className="rounded-full border border-line bg-surface/80 px-2.5 py-1 font-medium">
                    {t("catalogs.productCount", {
                      count: isLoading ? catalog.productCount : products.length,
                      defaultValue: `${isLoading ? catalog.productCount : products.length} products`,
                    })}
                  </span>
                  <span className="rounded-full border border-line bg-surface/80 px-2.5 py-1 font-medium uppercase tracking-wide">
                    {catalog.currency}
                  </span>
                </div>
              )}
            </DialogHeader>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncProducts}
              disabled={syncMutation.isPending || !connectionId}
              className="ms-14 shrink-0 gap-2 self-start border-line-strong bg-surface text-accent shadow-sm hover:border-line-strong hover:bg-muted hover:text-accent sm:ms-0 sm:self-center"
              data-testid="sync-products-button"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("catalogs.syncProducts", "Sync products")}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {/* Products list */}
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {t(
                "catalogs.errors.loadProductsFailed",
                "Failed to load products",
              )}
            </div>
          ) : isLoading ? (
            <div className="flex min-h-44 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-subtle px-5 py-10 text-center text-fg-muted">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-surface text-fg-subtle shadow-sm">
                <Package className="h-5 w-5" />
              </div>
              <p className="font-semibold text-fg">
                {t("catalogs.noProducts", "No products found")}
              </p>
              <p className="mt-1 max-w-sm text-sm">
                {t(
                  "catalogs.noProductsHint",
                  "Add products to this catalog in WhatsApp Business, then sync again.",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5" data-testid="products-list">
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
      className={cn(
        "group flex items-center gap-3.5 rounded-xl border border-line bg-surface p-3 transition-all hover:border-line-strong hover:shadow-md",
        product.visibility === "hidden" && "bg-subtle opacity-75",
      )}
      data-testid={`product-item-${product.productId}`}
    >
      {/* Product image */}
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-subtle">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <ImageIcon className="h-5 w-5 text-fg-subtle" />
        )}
      </div>

      {/* Product info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold text-fg">{product.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span className="font-semibold text-accent">
            {formatCurrency(product.price, product.currency)}
          </span>
          {product.sku && (
            <span className="font-mono text-[11px] text-fg-muted">
              {t("catalogs.sku", "SKU")} {product.sku}
            </span>
          )}
        </div>
        {product.category && (
          <span className="mt-1.5 inline-block rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
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
        className={cn(
          "h-8 shrink-0 gap-1.5 rounded-full border px-2.5 text-xs shadow-none",
          product.visibility === "hidden"
            ? "border-line bg-subtle text-fg-muted hover:bg-muted"
            : "border-accent/30 bg-subtle text-accent hover:bg-accent-soft hover:text-accent",
        )}
        aria-label={`${nextVisibility === "visible" ? "Show" : "Hide"} ${product.name}`}
      >
        {visibilityMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : product.visibility === "hidden" ? (
          <>
            <EyeOff className="h-4 w-4" />
            <span>{t("catalogs.hidden", "Hidden")}</span>
          </>
        ) : (
          <>
            <Eye className="h-4 w-4" />
            <span>{t("catalogs.visible", "Visible")}</span>
          </>
        )}
      </Button>
    </div>
  );
}
