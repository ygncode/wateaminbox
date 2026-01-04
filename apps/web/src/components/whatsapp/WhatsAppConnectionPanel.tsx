import { useEffect, useState, useCallback } from "react";
import {
  useWhatsAppConnection,
  type WhatsAppConnectionState,
} from "@/hooks/useWhatsAppConnection";
import {
  useWhatsAppConnections,
  type ConnectionWithState,
} from "@/hooks/useWhatsAppConnections";
import { Button, Badge, Skeleton } from "@/components/ui";
import {
  Smartphone,
  QrCode,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
  Plus,
  Trash2,
  MoreVertical,
  Edit2,
  Power,
  PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WhatsAppConnectionPanelProps {
  className?: string;
  compact?: boolean;
  multiConnection?: boolean;
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
}: WhatsAppConnectionPanelProps) {
  // Use multi-connection mode if enabled
  if (multiConnection) {
    return (
      <MultiConnectionPanel className={className} compact={compact} />
    );
  }

  // Legacy single-connection mode
  return (
    <SingleConnectionPanel className={className} compact={compact} />
  );
}

// =====================
// Multi-Connection Panel
// =====================

function MultiConnectionPanel({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const {
    connections,
    pendingConnection,
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
    connectedCount,
    totalCount,
  } = useWhatsAppConnections();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newConnectionName, setNewConnectionName] = useState("");
  const [editingConnection, setEditingConnection] = useState<string | null>(
    null
  );
  const [editName, setEditName] = useState("");

  // Handle add new connection
  const handleAddConnection = useCallback(async () => {
    try {
      await create(newConnectionName || undefined);
      setNewConnectionName("");
      setShowAddDialog(false);
    } catch (error) {
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
    [rename, editName]
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
              connectedCount > 0 ? "bg-green-500" : "bg-gray-400"
            )}
          />
          <span className="text-sm text-gray-600">
            {connectedCount}/{totalCount} connected
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-white rounded-lg border border-gray-200 p-6",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-whatsapp-teal-green/10 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-whatsapp-teal-green" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              WhatsApp Connections
            </h2>
            <p className="text-sm text-gray-500">
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

      {/* Add Connection Dialog */}
      {showAddDialog && (
        <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
          <h3 className="text-sm font-medium text-gray-900 mb-3">
            Add New Connection
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newConnectionName}
              onChange={(e) => setNewConnectionName(e.target.value)}
              placeholder="Connection name (optional)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green focus:border-transparent"
            />
            <Button
              size="sm"
              onClick={handleAddConnection}
              disabled={isCreating}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAddDialog(false);
                setNewConnectionName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Pending Connection with QR */}
      {pendingConnection && pendingConnection.qrCode && (
        <div className="mb-6 p-4 border border-blue-200 rounded-lg bg-blue-50">
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
              <h3 className="text-sm font-medium text-gray-900 mb-2">
                Scan to connect new device
              </h3>
              <ol className="text-xs text-gray-600 space-y-1">
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
        <div className="space-y-3">
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

// Connection Card Component
function ConnectionCard({
  connection,
  isEditing,
  editName,
  onEditNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onReconnect,
  onDisconnect,
  onDelete,
  onClearError,
}: {
  connection: ConnectionWithState;
  isEditing: boolean;
  editName: string;
  onEditNameChange: (name: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
  onClearError: () => void;
}) {
  const { localState } = connection;
  const [showMenu, setShowMenu] = useState(false);
  const [countdown, setCountdown] = useState<number>(0);

  // Countdown for QR expiry
  useEffect(() => {
    if (!localState.qrExpiresAt) {
      setCountdown(0);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.floor((localState.qrExpiresAt!.getTime() - Date.now()) / 1000)
      );
      setCountdown(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [localState.qrExpiresAt]);

  const statusColor = {
    connected: "bg-green-100 text-green-800 border-green-200",
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    disconnected: "bg-gray-100 text-gray-800 border-gray-200",
    error: "bg-red-100 text-red-800 border-red-200",
  }[connection.status];

  const statusIcon = {
    connected: <Wifi className="h-3 w-3" />,
    pending: <Loader2 className="h-3 w-3 animate-spin" />,
    disconnected: <WifiOff className="h-3 w-3" />,
    error: <XCircle className="h-3 w-3" />,
  }[connection.status];

  return (
    <div
      className={cn(
        "border rounded-lg p-4 transition-colors",
        connection.status === "connected"
          ? "border-green-200 bg-green-50/50"
          : "border-gray-200 bg-white"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {/* Status Icon */}
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
              connection.status === "connected"
                ? "bg-green-100"
                : "bg-gray-100"
            )}
          >
            {connection.status === "connected" ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : connection.status === "pending" || localState.isConnecting ? (
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
            ) : (
              <Smartphone className="h-5 w-5 text-gray-400" />
            )}
          </div>

          {/* Connection Info */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => onEditNameChange(e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveEdit();
                    if (e.key === "Escape") onCancelEdit();
                  }}
                  autoFocus
                />
                <Button size="sm" onClick={onSaveEdit}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-gray-900 truncate">
                    {connection.name}
                  </h3>
                  <Badge className={cn("text-xs", statusColor)}>
                    {statusIcon}
                    <span className="ml-1 capitalize">{connection.status}</span>
                  </Badge>
                </div>
                {connection.phoneNumber && (
                  <p className="text-sm text-whatsapp-teal-green font-medium mt-0.5">
                    {connection.phoneNumber}
                  </p>
                )}
                {connection.lastSync && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Last sync: {new Date(connection.lastSync).toLocaleString()}
                  </p>
                )}
              </>
            )}

            {/* Error Message */}
            {localState.error && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 flex-1">{localState.error}</p>
                <button
                  onClick={onClearError}
                  className="text-red-500 hover:text-red-700"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* QR Code for pending connection */}
            {localState.qrCode && (
              <div className="mt-3">
                <QRCodeDisplay
                  qrCode={localState.qrCode}
                  expiresAt={localState.qrExpiresAt}
                  countdown={countdown}
                  onRefresh={onReconnect}
                  isRefreshing={localState.isConnecting}
                  small
                />
              </div>
            )}
          </div>
        </div>

        {/* Actions Menu */}
        {!isEditing && (
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMenu(!showMenu)}
              className="h-8 w-8 p-0"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                  <button
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    onClick={() => {
                      onStartEdit();
                      setShowMenu(false);
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                    Rename
                  </button>
                  {connection.status === "connected" ? (
                    <button
                      className="w-full px-3 py-2 text-left text-sm text-orange-600 hover:bg-orange-50 flex items-center gap-2"
                      onClick={() => {
                        onDisconnect();
                        setShowMenu(false);
                      }}
                      disabled={localState.isDisconnecting}
                    >
                      {localState.isDisconnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <PowerOff className="h-4 w-4" />
                      )}
                      Disconnect
                    </button>
                  ) : (
                    <button
                      className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                      onClick={() => {
                        onReconnect();
                        setShowMenu(false);
                      }}
                      disabled={localState.isConnecting}
                    >
                      {localState.isConnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                      Reconnect
                    </button>
                  )}
                  <button
                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-100"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Are you sure you want to delete this connection?"
                        )
                      ) {
                        onDelete();
                      }
                      setShowMenu(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// QR Code Display Component
function QRCodeDisplay({
  qrCode,
  expiresAt,
  countdown,
  onRefresh,
  isRefreshing,
  small = false,
}: {
  qrCode: string;
  expiresAt: Date | null;
  countdown?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  small?: boolean;
}) {
  const [localCountdown, setLocalCountdown] = useState<number>(0);

  // Calculate countdown if not provided
  useEffect(() => {
    if (countdown !== undefined) {
      setLocalCountdown(countdown);
      return;
    }

    if (!expiresAt) {
      setLocalCountdown(0);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      );
      setLocalCountdown(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, countdown]);

  const displayCountdown = countdown !== undefined ? countdown : localCountdown;
  const size = small ? 128 : 200;

  return (
    <div className="relative inline-block">
      <div
        className={cn(
          "p-2 bg-white border rounded-lg",
          small ? "border-gray-200" : "border-2 border-gray-200"
        )}
      >
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(qrCode)}`}
          alt="WhatsApp QR Code"
          className={small ? "w-32 h-32" : "w-48 h-48"}
        />
        {displayCountdown <= 30 && displayCountdown > 0 && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-orange-600 font-medium text-sm">Expiring</p>
              <p className="text-xl font-bold text-gray-900">
                {displayCountdown}s
              </p>
            </div>
          </div>
        )}
        {displayCountdown === 0 && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-red-600 font-medium text-sm mb-1">Expired</p>
              <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
      {displayCountdown > 30 && (
        <p className="text-xs text-gray-400 text-center mt-1">
          Expires in {Math.floor(displayCountdown / 60)}:
          {String(displayCountdown % 60).padStart(2, "0")}
        </p>
      )}
    </div>
  );
}

// Empty state for connections list
function EmptyConnectionsView({
  onAdd,
  isCreating,
}: {
  onAdd: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
        <Smartphone className="h-10 w-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        No WhatsApp Connections
      </h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
        Add your first WhatsApp connection to start receiving and sending
        messages.
      </p>
      <Button
        onClick={onAdd}
        disabled={isCreating}
        className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
      >
        {isCreating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Plus className="h-4 w-4 mr-2" />
            Add Connection
          </>
        )}
      </Button>
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
        Math.floor((qrExpiresAt.getTime() - Date.now()) / 1000)
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
        "bg-white rounded-lg border border-gray-200 p-6",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-whatsapp-teal-green/10 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-whatsapp-teal-green" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              WhatsApp Connection
            </h2>
            <p className="text-sm text-gray-500">
              Link your WhatsApp Business account
            </p>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
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

// Helper components

function StatusIndicator({ state }: { state: WhatsAppConnectionState }) {
  const colors: Record<WhatsAppConnectionState, string> = {
    disconnected: "bg-gray-400",
    connecting: "bg-yellow-400 animate-pulse",
    waiting_qr: "bg-yellow-400 animate-pulse",
    scanning: "bg-blue-400 animate-pulse",
    connected: "bg-green-500",
    error: "bg-red-500",
  };

  return <div className={cn("w-2 h-2 rounded-full", colors[state])} />;
}

function StatusBadge({ state }: { state: WhatsAppConnectionState }) {
  const variants: Record<
    WhatsAppConnectionState,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      icon: React.ReactNode;
      label: string;
    }
  > = {
    disconnected: {
      variant: "secondary",
      icon: <WifiOff className="h-3 w-3" />,
      label: "Disconnected",
    },
    connecting: {
      variant: "outline",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: "Connecting",
    },
    waiting_qr: {
      variant: "outline",
      icon: <QrCode className="h-3 w-3" />,
      label: "Waiting for QR",
    },
    scanning: {
      variant: "outline",
      icon: <QrCode className="h-3 w-3 animate-pulse" />,
      label: "Scan QR Code",
    },
    connected: {
      variant: "default",
      icon: <Wifi className="h-3 w-3" />,
      label: "Connected",
    },
    error: {
      variant: "destructive",
      icon: <XCircle className="h-3 w-3" />,
      label: "Error",
    },
  };

  const { variant, icon, label } = variants[state];

  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {label}
    </Badge>
  );
}

function getStateLabel(state: WhatsAppConnectionState): string {
  const labels: Record<WhatsAppConnectionState, string> = {
    disconnected: "Not connected",
    connecting: "Connecting...",
    waiting_qr: "Waiting for QR...",
    scanning: "Scan QR code",
    connected: "Connected",
    error: "Connection error",
  };
  return labels[state];
}

function DisconnectedView({
  onConnect,
  isConnecting,
}: {
  onConnect: () => void;
  isConnecting: boolean;
}) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
        <Smartphone className="h-10 w-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        Connect WhatsApp
      </h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
        Link your WhatsApp Business account to start receiving and sending
        messages.
      </p>
      <Button
        onClick={onConnect}
        disabled={isConnecting}
        className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <QrCode className="h-4 w-4 mr-2" />
            Connect Device
          </>
        )}
      </Button>
    </div>
  );
}

function ConnectingView() {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-blue-50 flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        Initializing Connection
      </h3>
      <p className="text-sm text-gray-500">
        Please wait while we prepare the QR code...
      </p>
    </div>
  );
}

function LegacyQRCodeView({
  qrCode,
  countdown,
  onRefresh,
  isRefreshing,
}: {
  qrCode: string;
  countdown: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="text-center">
      {/* QR Code Container */}
      <div className="relative inline-block p-4 bg-white border-2 border-gray-200 rounded-xl mb-4">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}`}
          alt="WhatsApp QR Code"
          className="w-64 h-64"
        />
        {countdown <= 30 && countdown > 0 && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-orange-600 font-medium">QR Expiring</p>
              <p className="text-2xl font-bold text-gray-900">{countdown}s</p>
            </div>
          </div>
        )}
        {countdown === 0 && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-red-600 font-medium mb-2">QR Expired</p>
              <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="space-y-2 mb-4">
        <h3 className="text-lg font-medium text-gray-900">
          Scan with WhatsApp
        </h3>
        <ol className="text-sm text-gray-600 text-left max-w-xs mx-auto space-y-1">
          <li>1. Open WhatsApp on your phone</li>
          <li>2. Tap Menu or Settings</li>
          <li>3. Select Linked Devices</li>
          <li>4. Tap Link a Device</li>
          <li>5. Point your phone at this screen</li>
        </ol>
      </div>

      {/* Timer */}
      {countdown > 30 && (
        <p className="text-sm text-gray-400">
          QR code expires in {Math.floor(countdown / 60)}:
          {String(countdown % 60).padStart(2, "0")}
        </p>
      )}
    </div>
  );
}

function ConnectedView({
  phoneNumber,
  lastSync,
  onDisconnect,
  onRefresh,
  isDisconnecting,
}: {
  phoneNumber: string | null;
  lastSync: Date | null;
  onDisconnect: () => void;
  onRefresh: () => void;
  isDisconnecting: boolean;
}) {
  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">
        WhatsApp Connected
      </h3>
      {phoneNumber && (
        <p className="text-xl font-semibold text-whatsapp-teal-green mb-2">
          {phoneNumber}
        </p>
      )}
      {lastSync && (
        <p className="text-sm text-gray-500 mb-4">
          Last synced: {lastSync.toLocaleString()}
        </p>
      )}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh Status
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onDisconnect}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Disconnect"
          )}
        </Button>
      </div>
    </div>
  );
}

function ErrorView({
  error,
  onRetry,
  isRetrying,
}: {
  error: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
        <XCircle className="h-10 w-10 text-red-500" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        Connection Failed
      </h3>
      <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
        {error || "Unable to connect to WhatsApp. Please try again."}
      </p>
      <Button onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Retrying...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </>
        )}
      </Button>
    </div>
  );
}

export default WhatsAppConnectionPanel;
