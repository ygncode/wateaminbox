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
          <h3 className="text-sm font-semibold text-[#20362e] dark:text-dark-text-primary">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-[#718078] dark:text-dark-text-secondary">
            {description}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums",
            archived
              ? "bg-[#f2eee5] text-[#77684d] dark:bg-amber-900/25 dark:text-amber-200"
              : "bg-[#e2f2eb] text-[#096447] dark:bg-emerald-900/30 dark:text-emerald-200",
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
          ? "border-[#dedbd2] bg-[#fbfaf7] dark:border-amber-100/10 dark:bg-amber-950/[0.08]"
          : "border-[#dce5df] bg-[#fbfcfb] shadow-[0_1px_2px_rgba(16,33,27,0.03)] hover:-translate-y-px hover:border-[#bfd1c7] hover:shadow-[0_8px_24px_rgba(16,33,27,0.06)] dark:border-white/[0.08] dark:bg-white/[0.025] dark:hover:border-white/[0.14]",
      )}
      data-testid={`catalog-item-${catalog.catalogId}`}
    >
      {isArchived && (
        <span
          aria-hidden="true"
          className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#c8a75f] dark:bg-amber-500/60"
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div
            className={cn(
              "grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border",
              isArchived
                ? "border-[#e8dfca] bg-[#fff8e8] text-[#9a6d17] dark:border-amber-400/15 dark:bg-amber-900/20 dark:text-amber-300"
                : "border-[#f5ddbd] bg-[#fff2df] text-[#d85b08] dark:border-orange-400/15 dark:bg-orange-900/20 dark:text-orange-300",
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
            <h4 className="truncate text-[15px] font-semibold text-[#16271f] dark:text-dark-text-primary">
              {catalog.name}
            </h4>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#718078] dark:text-dark-text-secondary">
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

        <div className="mt-4 flex items-center gap-2 border-t border-[#e6ebe8] pt-3 sm:mt-0 sm:shrink-0 sm:border-0 sm:pt-0 dark:border-white/[0.07]">
          {isArchived && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestore}
              disabled={isRestoring || isArchiving}
              className="flex-1 gap-1.5 border-[#b9d8cc] bg-[#eff8f4] text-[#096447] shadow-none hover:border-[#9cc7b6] hover:bg-[#e2f2eb] hover:text-[#075239] sm:flex-none dark:border-emerald-400/20 dark:bg-emerald-900/20 dark:text-emerald-200 dark:hover:bg-emerald-900/35"
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
                ? "text-[#4f5f58] hover:bg-[#f2eee5] dark:text-dark-text-secondary dark:hover:bg-amber-900/20"
                : "border-[#d7e0da] bg-white text-[#315348] shadow-none hover:border-[#bfd1c7] hover:bg-[#f2f7f4] hover:text-[#163f32] dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-dark-text-primary",
            )}
            data-testid={`view-products-${catalog.catalogId}`}
          >
            {t("catalogs.viewProducts", "View products")}
            <ChevronRight className="h-4 w-4" />
          </Button>

          {!isArchived && (
            <EllipsisMenu
              items={menuItems}
              size="default"
              ariaLabel={t("catalogs.catalogActions", {
                defaultValue: "Actions for {{name}}",
                name: catalog.name,
              })}
              triggerClassName="text-[#718078] hover:bg-[#edf3ef] dark:text-dark-text-secondary"
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
      <DialogContent className="mx-3 flex max-h-[min(88dvh,760px)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border-[#dce5df] p-0 shadow-[0_24px_80px_rgba(8,28,20,0.22)] sm:w-full [&>button]:right-4 [&>button]:top-4 [&>button]:grid [&>button]:h-8 [&>button]:w-8 [&>button]:place-items-center [&>button]:rounded-full [&>button]:border [&>button]:border-[#d7e0da] [&>button]:bg-white [&>button]:opacity-100 [&>button]:shadow-sm hover:[&>button]:bg-[#edf3ef] dark:border-white/[0.1] dark:[&>button]:border-white/[0.1] dark:[&>button]:bg-dark-elevated dark:hover:[&>button]:bg-dark-tertiary">
        <div className="border-b border-[#e2e8e3] bg-[linear-gradient(135deg,#f7faf8_0%,#fdfcf8_100%)] px-5 py-5 pr-14 dark:border-white/[0.08] dark:bg-none dark:bg-white/[0.025] sm:px-6 sm:py-6 sm:pr-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <DialogHeader className="min-w-0 space-y-0 text-left">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#f5ddbd] bg-[#fff2df] text-[#d85b08] dark:border-orange-400/15 dark:bg-orange-900/20 dark:text-orange-300">
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
                <div className="ml-14 mt-3 flex flex-wrap items-center gap-2 text-xs text-[#65736d] dark:text-dark-text-secondary">
                  <span className="rounded-full border border-[#dce5df] bg-white/80 px-2.5 py-1 font-medium dark:border-white/[0.08] dark:bg-white/[0.04]">
                    {t("catalogs.productCount", {
                      count: isLoading ? catalog.productCount : products.length,
                      defaultValue: `${isLoading ? catalog.productCount : products.length} products`,
                    })}
                  </span>
                  <span className="rounded-full border border-[#dce5df] bg-white/80 px-2.5 py-1 font-medium uppercase tracking-wide dark:border-white/[0.08] dark:bg-white/[0.04]">
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
              className="ml-14 shrink-0 gap-2 self-start border-[#b9d8cc] bg-white text-[#096447] shadow-sm hover:border-[#9cc7b6] hover:bg-[#eff8f4] hover:text-[#075239] sm:ml-0 sm:self-center dark:border-emerald-400/20 dark:bg-white/[0.04] dark:text-emerald-200 dark:hover:bg-emerald-900/25"
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
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              {t(
                "catalogs.errors.loadProductsFailed",
                "Failed to load products",
              )}
            </div>
          ) : isLoading ? (
            <div className="flex min-h-44 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#718078] dark:text-dark-text-tertiary" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-[#d6dfd9] bg-[#f8faf8] px-5 py-10 text-center text-[#65736d] dark:border-white/[0.1] dark:bg-white/[0.025] dark:text-dark-text-secondary">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-white text-[#9aa8a1] shadow-sm dark:bg-white/[0.05] dark:text-dark-text-tertiary">
                <Package className="h-5 w-5" />
              </div>
              <p className="font-semibold text-[#31463e] dark:text-dark-text-primary">
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
        "group flex items-center gap-3.5 rounded-xl border border-[#dfe6e2] bg-white p-3 transition-all hover:border-[#c8d5ce] hover:shadow-[0_5px_18px_rgba(16,33,27,0.05)] dark:border-white/[0.08] dark:bg-white/[0.025] dark:hover:border-white/[0.14]",
        product.visibility === "hidden" &&
          "bg-[#f8faf8] opacity-75 dark:bg-white/[0.015]",
      )}
      data-testid={`product-item-${product.productId}`}
    >
      {/* Product image */}
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#e3e9e5] bg-[#f3f6f4] dark:border-white/[0.07] dark:bg-white/[0.04]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <ImageIcon className="h-5 w-5 text-[#9aa8a1] dark:text-dark-text-tertiary" />
        )}
      </div>

      {/* Product info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold text-[#20362e] dark:text-dark-text-primary">
          {product.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#718078] dark:text-dark-text-secondary">
          <span className="font-semibold text-[#315348] dark:text-dark-text-primary">
            {formatCurrency(product.price, product.currency)}
          </span>
          {product.sku && (
            <span className="font-mono text-[11px] text-[#829089] dark:text-dark-text-tertiary">
              {t("catalogs.sku", "SKU")} {product.sku}
            </span>
          )}
        </div>
        {product.category && (
          <span className="mt-1.5 inline-block rounded-md bg-[#edf3ef] px-1.5 py-0.5 text-[10px] font-medium text-[#52675f] dark:bg-white/[0.05] dark:text-dark-text-secondary">
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
            ? "border-[#d9dfdc] bg-[#f4f6f5] text-[#65736d] hover:bg-[#e9eeeb] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-dark-text-secondary"
            : "border-[#bde0d1] bg-[#eff8f4] text-[#087a5c] hover:bg-[#e0f1e9] hover:text-[#096447] dark:border-emerald-400/15 dark:bg-emerald-900/20 dark:text-emerald-200",
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

export default CatalogManager;
