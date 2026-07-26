import { formatAuditTime } from "@wateaminbox/shared";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Edit2,
  Loader2,
  MoreVertical,
  Phone,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ConnectionWithState } from "@/hooks/useWhatsAppConnections";
import { cn } from "@/lib/utils";

interface ConnectionCardProps {
  connection: ConnectionWithState;
  isEditing: boolean;
  editName: string;
  onEditNameChange: (name: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onReconnect: () => void;
  onViewQr: () => void;
  onDisconnect: () => void;
  onDelete: () => void | Promise<unknown>;
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
  onViewQr,
  onDisconnect,
  onDelete,
  onClearError,
}: ConnectionCardProps) {
  const { localState } = connection;
  const [showMenu, setShowMenu] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const statusColor = {
    connected:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200",
    pending:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200",
    disconnected:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-[#b7c8c1]",
    banned:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200",
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200",
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
        "overflow-visible rounded-2xl border border-[#dce3de] bg-white p-4 shadow-[0_1px_2px_rgba(16,33,27,.035)] transition-[border-color,box-shadow] duration-200 hover:border-[#c8d3cc] hover:shadow-[0_8px_24px_rgba(16,33,27,.06)] dark:border-white/[0.08] dark:bg-white/[0.025] dark:hover:border-white/[0.14] dark:hover:shadow-none sm:p-5",
        localState.error &&
          "border-red-200 dark:border-red-400/20 dark:bg-red-400/[0.025]",
      )}
    >
      <div className="flex flex-col gap-4 overflow-visible sm:flex-row sm:items-start sm:justify-between">
        <div className="flex w-full min-w-0 flex-1 items-start gap-3">
          {/* Status Icon */}
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
              connection.status === "connected"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/15"
                : connection.status === "pending"
                  ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/15"
                  : "bg-[#f3f6f3] text-[#65736d] ring-[#e2e8e3] dark:bg-white/[0.06] dark:text-[#a9bab4] dark:ring-white/[0.08]",
            )}
          >
            {connection.status === "connected" ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : connection.status === "pending" || localState.isConnecting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Smartphone className="h-5 w-5" />
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
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="min-w-0 truncate text-base font-semibold tracking-tight text-[#10211b] dark:text-[#eff7f3]">
                    {connection.name}
                  </h3>
                  <Badge
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold",
                      statusColor,
                    )}
                  >
                    {statusIcon}
                    <span className="ml-1 capitalize">{connection.status}</span>
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#65736d] dark:text-[#9cafa8]">
                  {connection.phoneNumber && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-[#829089]" />
                      <span className="font-medium tabular-nums text-[#315348] dark:text-[#c9d8d2]">
                        {connection.phoneNumber}
                      </span>
                    </span>
                  )}
                  {connection.lastSync && (
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5 text-[#829089]" />
                      Synced {formatAuditTime(connection.lastSync)}
                    </span>
                  )}
                </div>
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
          </div>
        </div>

        {/* Quick Actions + Menu */}
        {!isEditing && (
          <div className="flex w-full items-center justify-end gap-2 border-t border-slate-200/80 pt-3 dark:border-white/[0.08] sm:w-auto sm:border-0 sm:pt-0">
            {/* Keep routine actions visible; destructive disconnect stays in More. */}
            {connection.status === "disconnected" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onReconnect}
                disabled={localState.isConnecting}
                className="border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 dark:border-emerald-400/20 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
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
                size="sm"
                onClick={onViewQr}
                disabled={localState.isDisconnecting}
                className="gap-2 bg-[#087a5c] text-white hover:bg-[#06674e] dark:bg-[#159b73] dark:hover:bg-[#20ad83]"
              >
                {localState.qrCode ? (
                  <QrCode className="h-4 w-4" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {localState.qrCode ? "View QR code" : "View setup"}
              </Button>
            ) : null}

            {/* 3-dot menu */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMenu(!showMenu)}
                className="h-8 w-8 p-0"
                aria-label={`More actions for ${connection.name}`}
                title="More actions"
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
                    ) : connection.status === "pending" ? (
                      <button
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-orange-600 transition-colors hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
                        onClick={() => {
                          onDisconnect();
                          setShowMenu(false);
                        }}
                        disabled={localState.isDisconnecting}
                      >
                        {localState.isDisconnecting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        Cancel setup
                      </button>
                    ) : (
                      <button
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-whatsapp-teal-green transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
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
                        setDeleteOpen(true);
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
      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${connection.name}?`}
        description="This permanently removes the connection from this workspace. You will need to link the device again to use this number."
        confirmText="Delete connection"
        onConfirm={async () => {
          await onDelete();
          setDeleteOpen(false);
        }}
        isDestructive
      />
    </div>
  );
}
