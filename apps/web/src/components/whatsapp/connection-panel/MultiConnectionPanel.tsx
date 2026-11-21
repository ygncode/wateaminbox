import { Loader2, Plus, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChannelAccountCard } from "@/components/connections/ChannelAccountCard";
import { ChannelPickerDialog } from "@/components/connections/ChannelPickerDialog";
import type { ChannelCatalogEntry } from "@/components/connections/channel-catalog";
import { TelegramConnectDialog } from "@/components/connections/TelegramConnectDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useChannelAccounts,
  useChannelProviderAvailability,
  useConnectTelegramBot,
  useDisconnectChannelAccount,
  usePurgeChannelAccount,
  usePauseChannelAccount,
  useRenameChannelAccount,
  useResumeChannelAccount,
} from "@/hooks/useChannelAccounts";
import { useWhatsAppConnections } from "@/hooks/useWhatsAppConnections";
import { useArchivedWhatsAppConnections } from "@/hooks/whatsapp/useArchivedWhatsAppConnections";
import { getWorkspaceBillingUrl } from "@/lib/billing-url";
import { cn } from "@/lib/utils";
import { injectAnimationStyles, removeAnimationStyles } from "../animations";
import { ConnectionCard } from "../ConnectionCard";
import { EmptyConnectionsView } from "../EmptyConnectionsView";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { ArchivedConnectionCard } from "./ArchivedConnectionCard";
import { GlobalErrorBanner } from "./GlobalErrorBanner";
import { getConnectionSetupStage } from "./setup-state";
import type { MultiConnectionPanelProps } from "./types";

/**
 * Multi-connection panel for managing multiple WhatsApp connections
 */
export function MultiConnectionPanel({
  className,
  compact = false,
  hideHeader = false,
}: MultiConnectionPanelProps) {
  const { t } = useTranslation();
  const { activeWorkspace } = useWorkspace();
  const billingUrl =
    activeWorkspace?.role === "owner"
      ? getWorkspaceBillingUrl(activeWorkspace.id)
      : null;

  const {
    connections,
    globalError,
    pendingConnection,
    clearPendingConnection,
    isLoading,
    isCreating,
    create,
    reconnect,
    disconnect,
    remove,
    rename,
    refresh,
    clearError,
    clearGlobalError,
    connectedCount,
    totalCount,
  } = useWhatsAppConnections();
  const {
    archivedConnections,
    relinkArchived,
    purgeArchived,
    relinkingId,
    purgingId,
  } = useArchivedWhatsAppConnections();

  // Channel accounts are the neutral, non-linked-device connections. They are
  // fetched alongside the WhatsApp list rather than replacing it: linked
  // device connections stay authoritative in their own table until the RFC's
  // legacy retirement phase.
  const { data: channelAccounts = [] } = useChannelAccounts();
  const { data: providerAvailability, isLoading: isLoadingAvailability } =
    useChannelProviderAvailability();
  const connectTelegram = useConnectTelegramBot();
  const disconnectChannelAccount = useDisconnectChannelAccount();
  const purgeChannelAccount = usePurgeChannelAccount();
  const renameChannelAccount = useRenameChannelAccount();
  const pauseChannelAccount = usePauseChannelAccount();
  const resumeChannelAccount = useResumeChannelAccount();
  const [pausingAccountId, setPausingAccountId] = useState<string | null>(null);
  const [resumingAccountId, setResumingAccountId] = useState<string | null>(
    null,
  );
  const [renamingAccountId, setRenamingAccountId] = useState<string | null>(
    null,
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [connectedTelegramName, setConnectedTelegramName] = useState<
    string | null
  >(null);
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<
    string | null
  >(null);
  const [purgingAccountId, setPurgingAccountId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [setupConnectionId, setSetupConnectionId] = useState<string | null>(
    null,
  );
  const [newConnectionName, setNewConnectionName] = useState("");
  const [editingConnection, setEditingConnection] = useState<string | null>(
    null,
  );
  const [editName, setEditName] = useState("");

  // Inject animation styles into document head
  useEffect(() => {
    injectAnimationStyles();
    return () => removeAnimationStyles();
  }, []);

  const setupConnection = setupConnectionId
    ? (connections.find((connection) => connection.id === setupConnectionId) ??
      null)
    : null;

  /** Start the WhatsApp linked-device flow (naming, then QR pairing). */
  const openWhatsAppSetup = useCallback(() => {
    clearGlobalError();
    clearPendingConnection();
    setSetupConnectionId(null);
    setNewConnectionName("");
    setShowAddDialog(true);
  }, [clearGlobalError, clearPendingConnection]);

  /** "Add connection" now asks which channel before starting any flow. */
  const openChannelPicker = useCallback(() => {
    clearGlobalError();
    setPickerOpen(true);
  }, [clearGlobalError]);

  const handleChannelSelected = useCallback(
    (entry: ChannelCatalogEntry) => {
      setPickerOpen(false);
      if (entry.provider === "whatsapp_linked_device") {
        openWhatsAppSetup();
        return;
      }
      if (entry.provider === "telegram_bot") {
        connectTelegram.reset();
        setConnectedTelegramName(null);
        setTelegramOpen(true);
      }
    },
    [connectTelegram, openWhatsAppSetup],
  );

  // The header counts every channel, not just linked devices.
  const connectedChannelAccounts = channelAccounts.filter(
    (account) => account.status === "connected",
  ).length;
  const totalConnected = connectedCount + connectedChannelAccounts;
  const totalAccounts = totalCount + channelAccounts.length;
  const channelsInUse = new Set([
    ...(connections.length > 0 ? ["whatsapp"] : []),
    ...channelAccounts.map((account) => account.channel),
  ]).size;

  const connectedCounts = useMemo(() => {
    const counts: Record<string, number> = {
      whatsapp_linked_device: connections.length,
    };
    for (const account of channelAccounts) {
      counts[account.provider] = (counts[account.provider] ?? 0) + 1;
    }
    return counts;
  }, [channelAccounts, connections.length]);

  const closeSetup = useCallback(() => {
    setShowAddDialog(false);
    setSetupConnectionId(null);
    setNewConnectionName("");
  }, []);

  // Keep the dialog open between naming and QR pairing.
  const handleAddConnection = useCallback(async () => {
    try {
      const created = await create(newConnectionName || undefined);
      setSetupConnectionId(created.id);
      setNewConnectionName("");
    } catch (_error) {
      // Error is handled by the hook
    }
  }, [create, newConnectionName]);

  const resumeSetup = useCallback((connectionId: string) => {
    setSetupConnectionId(connectionId);
    setShowAddDialog(true);
  }, []);

  const handleReconnect = useCallback(
    async (connectionId: string) => {
      resumeSetup(connectionId);
      try {
        await reconnect(connectionId);
      } catch (_error) {
        // Error is displayed in the setup dialog and connection card.
      }
    },
    [reconnect, resumeSetup],
  );

  const handleRelinkArchived = useCallback(
    async (connectionId: string) => {
      await relinkArchived(connectionId);
      setSetupConnectionId(connectionId);
      setShowAddDialog(true);
      await refresh();
    },
    [refresh, relinkArchived],
  );

  // Close shortly after the refreshed list confirms the connection.
  useEffect(() => {
    if (
      !showAddDialog ||
      getConnectionSetupStage(setupConnection) !== "connected"
    )
      return;
    const timer = window.setTimeout(closeSetup, 700);
    return () => window.clearTimeout(timer);
  }, [closeSetup, setupConnection?.status, showAddDialog]);

  // Handle rename connection
  const handleRename = useCallback(
    async (connectionId: string) => {
      if (editName.trim()) {
        await rename(connectionId, editName.trim());
        setEditingConnection(null);
        setEditName("");
      }
    },
    [rename, editName],
  );

  if (isLoading) {
    if (compact) {
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      );
    }

    return (
      <div
        className={cn(
          !hideHeader && "rounded-2xl border border-line bg-surface p-6",
          className,
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between",
            hideHeader
              ? "mb-4 rounded-xl border border-line bg-subtle p-3.5"
              : "mb-6",
          )}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="flex gap-2">
            {hideHeader && <Skeleton className="size-9 rounded-lg" />}
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="flex min-h-24 items-center gap-3 rounded-xl border border-line bg-subtle p-4"
            >
              <Skeleton className="size-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex items-center gap-1">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              connectedCount > 0 ? "bg-primary" : "bg-fg-subtle",
            )}
          />
          <span className="text-sm text-fg-muted">
            {connectedCount}/{totalCount} connected
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        hideHeader ? "" : "rounded-2xl border border-line bg-surface p-6",
        className,
      )}
    >
      {/* Header - hidden when wrapped in SettingsCard */}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
              <Smartphone className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-fg">
                {t("connections.panelTitle", "Connections")}
              </h2>
              <p className="text-sm text-fg-muted">
                {totalConnected} of {totalAccounts} connections active
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={openChannelPicker}
              disabled={isCreating}
              className="bg-primary hover:bg-primary-hover"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 me-1" />
                  {t("connections.addConnection", "Add Connection")}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Workspace connection summary and actions. */}
      {hideHeader && totalAccounts > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-subtle p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised text-accent shadow-sm ring-1 ring-line-strong">
              <Smartphone className="h-5 w-5" aria-hidden="true" />
              <span
                className={cn(
                  "absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-line",
                  connectedCount > 0 ? "bg-primary" : "bg-fg-subtle",
                )}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-fg">
                {totalConnected} active connection
                {totalConnected === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-fg-muted">
                {totalAccounts} account{totalAccounts === 1 ? "" : "s"} across{" "}
                {channelsInUse} channel{channelsInUse === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              className="h-9 w-9 border-line p-0 hover:border-accent hover:text-accent"
              aria-label={t("connections.refresh", "Refresh connections")}
              title={t("connections.refresh", "Refresh connections")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={openChannelPicker}
              disabled={isCreating}
              className="h-9 gap-2 bg-primary px-3.5 font-semibold text-on-primary hover:bg-primary-hover"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("connections.addConnectionButton")}
            </Button>
          </div>
        </div>
      )}

      {/* Global Error Banner (e.g., max connections exceeded) */}
      {globalError && !showAddDialog && (
        <GlobalErrorBanner
          error={globalError}
          onDismiss={clearGlobalError}
          billingUrl={billingUrl}
        />
      )}

      {pickerOpen && (
        <ChannelPickerDialog
          availability={providerAvailability}
          isLoadingAvailability={isLoadingAvailability}
          connectedCounts={connectedCounts}
          onSelect={handleChannelSelected}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {telegramOpen && (
        <TelegramConnectDialog
          isConnecting={connectTelegram.isPending}
          error={
            connectTelegram.error
              ? ((connectTelegram.error as Error).message ??
                t("connections.telegramConnectFailed"))
              : null
          }
          connectedName={connectedTelegramName}
          onSubmit={(input) => {
            connectTelegram.mutate(input, {
              onSuccess: (account) => {
                setConnectedTelegramName(
                  account.displayName?.trim() ||
                    t("connections.yourTelegramBot"),
                );
              },
            });
          }}
          onCancel={() => {
            setTelegramOpen(false);
            setConnectedTelegramName(null);
            connectTelegram.reset();
          }}
        />
      )}

      {/* Resumable naming and QR setup dialog. */}
      {showAddDialog && (
        <AddConnectionDialog
          errorContent={
            globalError ? (
              <GlobalErrorBanner
                error={globalError}
                billingUrl={billingUrl}
                onDismiss={() => {
                  clearGlobalError();
                  clearPendingConnection();
                }}
              />
            ) : pendingConnection?.error ? (
              <p
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
              >
                {pendingConnection.error}
              </p>
            ) : null
          }
          name={newConnectionName}
          onNameChange={setNewConnectionName}
          onSubmit={handleAddConnection}
          onCancel={closeSetup}
          isCreating={isCreating}
          connection={setupConnection}
          onReconnect={() => {
            if (setupConnectionId) {
              void handleReconnect(setupConnectionId);
            }
          }}
        />
      )}

      {/* Non-linked-device channel accounts, in the same list as WhatsApp. */}
      {channelAccounts.length > 0 && (
        <div className="mb-3 space-y-3">
          {channelAccounts.map((account) => (
            <ChannelAccountCard
              key={account.id}
              account={account}
              isDisconnecting={disconnectingAccountId === account.id}
              isPurging={purgingAccountId === account.id}
              onPurge={() => {
                setPurgingAccountId(account.id);
                purgeChannelAccount.mutate(account.id, {
                  onSettled: () => setPurgingAccountId(null),
                });
              }}
              isRenaming={renamingAccountId === account.id}
              isPausing={pausingAccountId === account.id}
              isResuming={resumingAccountId === account.id}
              onPause={() => {
                setPausingAccountId(account.id);
                pauseChannelAccount.mutate(account.id, {
                  onSettled: () => setPausingAccountId(null),
                });
              }}
              onResume={() => {
                setResumingAccountId(account.id);
                resumeChannelAccount.mutate(account.id, {
                  onSettled: () => setResumingAccountId(null),
                });
              }}
              onRename={(displayName) => {
                setRenamingAccountId(account.id);
                renameChannelAccount.mutate(
                  { channelAccountId: account.id, displayName },
                  { onSettled: () => setRenamingAccountId(null) },
                );
              }}
              onDisconnect={() => {
                setDisconnectingAccountId(account.id);
                disconnectChannelAccount.mutate(account.id, {
                  onSettled: () => setDisconnectingAccountId(null),
                });
              }}
            />
          ))}
        </div>
      )}

      {/* Connections List */}
      {connections.length === 0 && channelAccounts.length === 0 ? (
        <EmptyConnectionsView
          onAdd={openChannelPicker}
          isCreating={isCreating}
        />
      ) : (
        <div className="space-y-3 overflow-visible">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              isEditing={editingConnection === connection.id}
              editName={editName}
              onEditNameChange={setEditName}
              onStartEdit={() => {
                setEditingConnection(connection.id);
                setEditName(connection.name);
              }}
              onCancelEdit={() => {
                setEditingConnection(null);
                setEditName("");
              }}
              onSaveEdit={() => handleRename(connection.id)}
              onReconnect={() => void handleReconnect(connection.id)}
              onViewQr={() => resumeSetup(connection.id)}
              onDisconnect={() => disconnect(connection.id)}
              onDelete={() => remove(connection.id)}
              onClearError={() => clearError(connection.id)}
            />
          ))}
        </div>
      )}

      {archivedConnections.length > 0 && (
        <section className="mt-7 border-t border-line/80 pt-5">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-fg">
              {t("connections.archivedAccounts", "Archived accounts")}
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              {t(
                "connections.archivedAccountsHint",
                "Link a number again to restore its original inbox, or permanently erase its retained data.",
              )}
            </p>
          </div>
          <div className="space-y-3">
            {archivedConnections.map((connection) => (
              <ArchivedConnectionCard
                key={connection.id}
                connection={connection}
                isRelinking={relinkingId === connection.id}
                isPurging={purgingId === connection.id}
                onRelink={() => handleRelinkArchived(connection.id)}
                onPurge={async () => {
                  await purgeArchived(connection.id);
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
