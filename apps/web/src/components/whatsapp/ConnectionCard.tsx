import {
  AlertCircle,
  CheckCircle2,
  Edit2,
  Loader2,
  MoreVertical,
  Phone,
  Power,
  PowerOff,
  RefreshCw,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatAuditTime, nowMs } from "@whatsapp-web/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectionWithState } from "@/hooks/useWhatsAppConnections";
import { cn } from "@/lib/utils";
import { QRCodeDisplay } from "./QRCodeDisplay";

interface ConnectionCardProps {
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
}

/**
 * Connection Card Component
 * Displays a single WhatsApp connection with status, actions, and QR code
 */
export function ConnectionCard({
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
}: ConnectionCardProps) {
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
      const expiresAt = localState.qrExpiresAt;
      if (!expiresAt) return;
      const remaining = Math.max(
        0,
        Math.floor((expiresAt.getTime() - nowMs()) / 1000),
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
    banned: "bg-red-100 text-red-800 border-red-200",
    error: "bg-red-100 text-red-800 border-red-200",
  }[connection.status];

  const statusIcon = {
    connected: <Wifi className="h-3 w-3" />,
    pending: <Loader2 className="h-3 w-3 animate-spin" />,
    disconnected: <WifiOff className="h-3 w-3" />,
    banned: <XCircle className="h-3 w-3" />,
    error: <XCircle className="h-3 w-3" />,
  }[connection.status];

  return (
    <div
      className={cn(
        "border rounded-lg p-4 transition-colors overflow-visible",
        connection.status === "connected"
          ? "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20"
          : "border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated",
      )}
    >
      <div className="flex items-start justify-between overflow-visible">
        <div className="flex items-start gap-3 flex-1">
          {/* Status Icon */}
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
              connection.status === "connected"
                ? "bg-green-100 dark:bg-green-900/50"
                : "bg-gray-100 dark:bg-dark-tertiary",
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
                  className="flex-1 px-2 py-1 border border-gray-300 dark:border-dark-border rounded text-sm bg-white dark:bg-dark-tertiary text-gray-900 dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveEdit();
                    if (e.key === "Escape") onCancelEdit();
                  }}
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
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-dark-text-primary truncate min-w-0 flex-1">
                    {connection.name}
                  </h3>
                  <Badge className={cn("text-xs flex-shrink-0", statusColor)}>
                    {statusIcon}
                    <span className="ml-1 capitalize">{connection.status}</span>
                  </Badge>
                </div>
                {connection.phoneNumber && (
                  <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-0.5 flex items-center gap-1.5">
                    <span>Phone</span>
                    <span className="text-gray-400 dark:text-dark-text-tertiary">
                      -
                    </span>
                    <Phone className="h-3.5 w-3.5 text-whatsapp-teal-green" />
                    <span className="text-whatsapp-teal-green font-medium">
                      {connection.phoneNumber}
                    </span>
                  </p>
                )}
                {connection.lastSync && (
                  <p className="text-xs text-gray-500 dark:text-dark-text-tertiary mt-0.5">
                    Last sync: {formatAuditTime(connection.lastSync)}
                  </p>
                )}
              </>
            )}

            {/* Error Message */}
            {localState.error && (
              <div className="mt-3 animate-fade-in">
                <div className="relative overflow-hidden rounded-lg border border-red-200/60 dark:border-red-800/60 bg-red-50 dark:bg-red-900/30 p-3 shadow-sm">
                  {/* Decorative accent line */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-400" />

                  <div className="flex items-start gap-2.5 pl-2">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                      <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-800 dark:text-red-300">
                        Connection Error
                      </p>
                      <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5 leading-relaxed">
                        {localState.error}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={onReconnect}
                          className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 bg-red-100 dark:bg-red-900/50 hover:bg-red-200/70 dark:hover:bg-red-800/50 px-2.5 py-1 rounded-md transition-all duration-200"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                        <button
                          onClick={onClearError}
                          className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={onClearError}
                      className="flex-shrink-0 p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-all"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
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

        {/* Quick Actions + Menu */}
        {!isEditing && (
          <div className="flex items-center gap-2">
            {/* Quick action button based on status */}
            {connection.status === "connected" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={localState.isDisconnecting}
                className="text-orange-600 border-orange-200 hover:bg-orange-50 hover:border-orange-300"
              >
                {localState.isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <PowerOff className="h-4 w-4 mr-1.5" />
                    Disconnect
                  </>
                )}
              </Button>
            ) : connection.status === "disconnected" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onReconnect}
                disabled={localState.isConnecting}
                className="text-whatsapp-teal-green border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300"
              >
                {localState.isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Power className="h-4 w-4 mr-1.5" />
                    Reconnect
                  </>
                )}
              </Button>
            ) : connection.status === "pending" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={localState.isDisconnecting}
                className="text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
              >
                {localState.isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <X className="h-4 w-4 mr-1.5" />
                    Cancel
                  </>
                )}
              </Button>
            ) : null}

            {/* 3-dot menu */}
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
                  <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-dark-elevated border border-gray-200 dark:border-dark-border rounded-xl shadow-xl shadow-gray-200/50 dark:shadow-black/30 z-20 py-1.5 animate-fade-in">
                    <button
                      className="w-full px-3.5 py-2.5 text-left text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary flex items-center gap-2.5 transition-colors"
                      onClick={() => {
                        onStartEdit();
                        setShowMenu(false);
                      }}
                    >
                      <Edit2 className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
                      Rename
                    </button>
                    {connection.status === "connected" ? (
                      <button
                        className="w-full px-3.5 py-2.5 text-left text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 flex items-center gap-2.5 transition-colors"
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
                        className="w-full px-3.5 py-2.5 text-left text-sm text-whatsapp-teal-green hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center gap-2.5 transition-colors"
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
                    <div className="my-1.5 border-t border-gray-100 dark:border-dark-border" />
                    <button
                      className="w-full px-3.5 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2.5 transition-colors"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Are you sure you want to delete this connection?",
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
          </div>
        )}
      </div>
    </div>
  );
}
