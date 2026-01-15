import { Loader2, Plus, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhatsAppConnections } from "@/hooks/useWhatsAppConnections";
import { cn } from "@/lib/utils";
import { injectAnimationStyles, removeAnimationStyles } from "../animations";
import { ConnectionCard } from "../ConnectionCard";
import { EmptyConnectionsView } from "../EmptyConnectionsView";
import { QRCodeDisplay } from "../QRCodeDisplay";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { GlobalErrorBanner } from "./GlobalErrorBanner";
import type { MultiConnectionPanelProps } from "./types";

/**
 * Multi-connection panel for managing multiple WhatsApp connections
 */
export function MultiConnectionPanel({
  className,
  compact = false,
  hideHeader = false,
}: MultiConnectionPanelProps) {
  const {
    connections,
    pendingConnection,
    globalError,
    isLoading,
    isCreating,
    create,
    reconnect,
    disconnect,
    remove,
    rename,
    refresh,
    clearError,
    clearPendingConnection,
    clearGlobalError,
    connectedCount,
    totalCount,
  } = useWhatsAppConnections();

  const [showAddDialog, setShowAddDialog] = useState(false);
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

  // Handle add new connection
  const handleAddConnection = useCallback(async () => {
    try {
      await create(newConnectionName || undefined);
      setNewConnectionName("");
      setShowAddDialog(false);
    } catch (_error) {
      // Error is handled by the hook
    }
  }, [create, newConnectionName]);

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
    return (
      <div className={cn("p-6", className)}>
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
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
              connectedCount > 0
                ? "bg-green-500"
                : "bg-gray-400 dark:bg-gray-500",
            )}
          />
          <span className="text-sm text-gray-600 dark:text-dark-text-secondary">
            {connectedCount}/{totalCount} connected
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        hideHeader
          ? "p-4"
          : "bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6",
        className,
      )}
    >
      {/* Header - hidden when wrapped in SettingsCard */}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-whatsapp-teal-green/10 flex items-center justify-center">
              <Smartphone className="h-5 w-5 text-whatsapp-teal-green" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
                WhatsApp Connections
              </h2>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                {connectedCount} of {totalCount} connections active
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddDialog(true)}
              disabled={isCreating}
              className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Connection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Minimal action bar when header is hidden */}
      {hideHeader && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            {connectedCount} of {totalCount} connections active
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddDialog(true)}
              disabled={isCreating}
              className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Connection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Global Error Banner (e.g., max connections exceeded) */}
      {globalError && (
        <GlobalErrorBanner error={globalError} onDismiss={clearGlobalError} />
      )}

      {/* Add Connection Dialog */}
      {showAddDialog && (
        <AddConnectionDialog
          name={newConnectionName}
          onNameChange={setNewConnectionName}
          onSubmit={handleAddConnection}
          onCancel={() => {
            setShowAddDialog(false);
            setNewConnectionName("");
          }}
          isCreating={isCreating}
        />
      )}

      {/* Pending Connection with QR */}
      {pendingConnection?.qrCode && (
        <div className="mb-6 p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-900/30">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <QRCodeDisplay
                qrCode={pendingConnection.qrCode}
                expiresAt={pendingConnection.qrExpiresAt}
                onRefresh={() => {}}
                isRefreshing={false}
              />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 dark:text-dark-text-primary mb-2">
                Scan to connect new device
              </h3>
              <ol className="text-xs text-gray-600 dark:text-dark-text-secondary space-y-1">
                <li>1. Open WhatsApp on your phone</li>
                <li>2. Tap Menu or Settings</li>
                <li>3. Select Linked Devices</li>
                <li>4. Point your phone at this QR code</li>
              </ol>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3"
                onClick={clearPendingConnection}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Connections List */}
      {connections.length === 0 && !pendingConnection ? (
        <EmptyConnectionsView
          onAdd={() => setShowAddDialog(true)}
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
              onReconnect={() => reconnect(connection.id)}
              onDisconnect={() => disconnect(connection.id)}
              onDelete={() => remove(connection.id)}
              onClearError={() => clearError(connection.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
