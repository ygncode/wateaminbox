import {
  AlertCircle,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { useWhatsAppConnection } from "@/hooks/useWhatsAppConnection";
import { useWhatsAppConnections } from "@/hooks/useWhatsAppConnections";
import { cn } from "@/lib/utils";
import { injectAnimationStyles, removeAnimationStyles } from "./animations";
import { ConnectionCard } from "./ConnectionCard";
import { StatusBadge, StatusIndicator, getStateLabel } from "./ConnectionStatus";
import {
  ConnectedView,
  ConnectingView,
  DisconnectedView,
  ErrorView,
  LegacyQRCodeView,
} from "./ConnectionViews";
import { EmptyConnectionsView } from "./EmptyConnectionsView";
import { QRCodeDisplay } from "./QRCodeDisplay";
import { nowMs } from "@whatsapp-web/shared";

interface WhatsAppConnectionPanelProps {
  className?: string;
  compact?: boolean;
  multiConnection?: boolean;
  hideHeader?: boolean;
}

/**
 * WhatsApp Connection Panel
 * Displays QR code for linking device and connection status
 * Supports both single connection (legacy) and multi-connection modes
 */
export function WhatsAppConnectionPanel({
  className,
  compact = false,
  multiConnection = false,
  hideHeader = false,
}: WhatsAppConnectionPanelProps) {
  // Use multi-connection mode if enabled
  if (multiConnection) {
    return (
      <MultiConnectionPanel
        className={className}
        compact={compact}
        hideHeader={hideHeader}
      />
    );
  }

  // Legacy single-connection mode
  return <SingleConnectionPanel className={className} compact={compact} />;
}

// =====================
// Multi-Connection Panel
// =====================

function MultiConnectionPanel({
  className,
  compact = false,
  hideHeader = false,
}: {
  className?: string;
  compact?: boolean;
  hideHeader?: boolean;
}) {
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

// =====================
// Global Error Banner
// =====================

function GlobalErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-6 animate-slide-down">
      <div className="relative overflow-hidden rounded-xl border border-amber-300/50 dark:border-amber-700/50 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-900/30 dark:via-orange-900/30 dark:to-amber-900/30 p-4 shadow-lg shadow-amber-100/50 dark:shadow-amber-900/20">
        {/* Decorative shimmer overlay */}
        <div className="absolute inset-0 animate-shimmer opacity-30 pointer-events-none" />

        <div className="relative flex items-start gap-4">
          {/* Animated icon with pulse ring */}
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-pulse-ring" />
            <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-400/30">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>

          <div className="flex-1 pt-1">
            <h3 className="text-base font-semibold text-amber-900 dark:text-amber-300 tracking-tight">
              Connection Limit Reached
            </h3>
            <p className="text-sm text-amber-700/90 dark:text-amber-400/90 mt-1 leading-relaxed">
              {error}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 bg-amber-200/50 dark:bg-amber-800/50 hover:bg-amber-200 dark:hover:bg-amber-700/50 px-3 py-1.5 rounded-full transition-all duration-200">
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade Plan
              </button>
              <span className="text-amber-400">•</span>
              <button
                onClick={onDismiss}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-all duration-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================
// Add Connection Dialog
// =====================

function AddConnectionDialog({
  name,
  onNameChange,
  onSubmit,
  onCancel,
  isCreating,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="mb-6 animate-slide-down">
      <div className="relative overflow-hidden rounded-xl border border-whatsapp-teal-green/20 dark:border-whatsapp-teal-green/30 bg-gradient-to-br from-white via-emerald-50/30 to-teal-50/50 dark:from-dark-elevated dark:via-emerald-900/10 dark:to-teal-900/10 p-5 shadow-xl shadow-emerald-100/30 dark:shadow-emerald-900/10">
        {/* Decorative corner accent */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-whatsapp-teal-green/10 to-transparent rounded-full blur-2xl" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-whatsapp-teal-green to-whatsapp-dark-green flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Link2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
                Add New Connection
              </h3>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                Link a new WhatsApp device
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-dark-text-secondary mb-1.5">
                Connection Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="e.g., Support Team, Sales Phone..."
                className="w-full px-4 py-2.5 bg-white dark:bg-dark-tertiary border border-gray-200 dark:border-dark-border rounded-lg text-sm text-gray-900 dark:text-dark-text-primary placeholder:text-gray-400 dark:placeholder:text-dark-text-tertiary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green/50 focus:border-whatsapp-teal-green transition-all duration-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmit();
                  if (e.key === "Escape") onCancel();
                }}
              />
              <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-1.5">
                Optional – helps identify this connection
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={onSubmit}
                disabled={isCreating}
                className="flex-1 bg-gradient-to-r from-whatsapp-teal-green to-whatsapp-dark-green hover:from-whatsapp-dark-green hover:to-whatsapp-teal-green text-white shadow-lg shadow-emerald-500/20 transition-all duration-300"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Connection
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onCancel}
                className="px-4 border-gray-200 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-dark-tertiary"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================
// Single Connection Panel (Legacy)
// =====================

function SingleConnectionPanel({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const {
    state,
    qrCode,
    qrExpiresAt,
    phoneNumber,
    error,
    lastSync,
    connect,
    disconnect,
    refresh,
    isConnecting,
    isDisconnecting,
    isLoading,
  } = useWhatsAppConnection();

  // Countdown for QR expiry
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    if (!qrExpiresAt) {
      setCountdown(0);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.floor((qrExpiresAt.getTime() - nowMs()) / 1000),
      );
      setCountdown(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  if (isLoading) {
    return (
      <div className={cn("p-6", className)}>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 w-64 mx-auto" />
      </div>
    );
  }

  // Compact view for sidebar/header
  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <StatusIndicator state={state} />
        <span className="text-sm text-gray-600">
          {state === "connected"
            ? phoneNumber || "Connected"
            : getStateLabel(state)}
        </span>
        {state === "disconnected" && (
          <Button
            size="sm"
            variant="outline"
            onClick={connect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Connect"
            )}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-whatsapp-teal-green/10 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-whatsapp-teal-green" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
              WhatsApp Connection
            </h2>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
              Link your WhatsApp Business account
            </p>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Content based on state */}
      {state === "disconnected" && (
        <DisconnectedView onConnect={connect} isConnecting={isConnecting} />
      )}

      {(state === "connecting" || state === "waiting_qr") && <ConnectingView />}

      {state === "scanning" && qrCode && (
        <LegacyQRCodeView
          qrCode={qrCode}
          countdown={countdown}
          onRefresh={connect}
          isRefreshing={isConnecting}
        />
      )}

      {state === "connected" && (
        <ConnectedView
          phoneNumber={phoneNumber}
          lastSync={lastSync}
          onDisconnect={disconnect}
          onRefresh={refresh}
          isDisconnecting={isDisconnecting}
        />
      )}

      {state === "error" && (
        <ErrorView error={error} onRetry={connect} isRetrying={isConnecting} />
      )}
    </div>
  );
}

export default WhatsAppConnectionPanel;
