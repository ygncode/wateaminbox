import { formatAuditTime } from "@wateaminbox/shared";
import {
  AlertCircle,
  Clock3,
  Edit2,
  Loader2,
  MoreVertical,
  Phone,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WhatsAppMark } from "@/components/connections/channel-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ConnectionWithState } from "@/hooks/useWhatsAppConnections";
import { cn, formatPhoneNumber } from "@/lib/utils";

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
  const { t } = useTranslation();

  const { localState } = connection;
  const [showMenu, setShowMenu] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const statusColor = {
    connected: "border-accent/30 bg-accent-soft text-accent",
    pending: "border-warning/30 bg-warning-soft text-warning",
    disconnected: "border-line bg-subtle text-fg",
    banned: "border-danger/30 bg-danger-soft text-danger",
    error: "border-danger/30 bg-danger-soft text-danger",
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
        "overflow-visible rounded-2xl border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-lg dark:hover:shadow-none sm:p-5",
        localState.error && "border-danger/30 bg-danger-soft/40",
      )}
    >
      <div className="flex flex-col gap-4 overflow-visible sm:flex-row sm:items-start sm:justify-between">
        <div className="flex w-full min-w-0 flex-1 items-start gap-3">
          {/* Channel tile - the same brand tile a channel account row draws,
              so a WhatsApp number and a Telegram bot read as one list rather
              than as two features that happen to share a page. Status lives
              in the corner dot and the badge, not in the tile's colour. */}
          <div className="relative shrink-0">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-whatsapp text-white shadow-sm">
              {connection.status === "pending" || localState.isConnecting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <WhatsAppMark className="h-6 w-6" />
              )}
            </span>
            <span
              className={cn(
                "absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-surface",
                connection.status === "connected"
                  ? "bg-primary"
                  : connection.status === "pending"
                    ? "bg-warning"
                    : connection.status === "banned" ||
                        connection.status === "error"
                      ? "bg-danger"
                      : "bg-fg-subtle",
              )}
            />
          </div>

          {/* Connection Info */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => onEditNameChange(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-muted px-2 py-1 text-sm text-fg transition-all placeholder-fg-muted focus:border-primary focus:bg-surface focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveEdit();
                    if (e.key === "Escape") onCancelEdit();
                  }}
                />
                <Button size="sm" onClick={onSaveEdit}>
                  {t("common.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="min-w-0 truncate text-base font-semibold tracking-tight text-fg">
                    {connection.name}
                  </h3>
                  <Badge
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold",
                      statusColor,
                    )}
                  >
                    {statusIcon}
                    <span className="ms-1 capitalize">{connection.status}</span>
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                  {connection.phoneNumber && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-fg-muted" />
                      <span className="font-medium tabular-nums text-accent">
                        {formatPhoneNumber(connection.phoneNumber)}
                      </span>
                    </span>
                  )}
                  {connection.lastSync && (
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5 text-fg-muted" />
                      Synced {formatAuditTime(connection.lastSync)}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Error Message */}
            {localState.error && (
              <div className="mt-3 animate-fade-in">
                <div className="relative overflow-hidden rounded-lg border border-danger/30 bg-danger-soft p-3 shadow-sm">
                  {/* Decorative accent line */}
                  <div className="absolute start-0 top-0 bottom-0 w-1 bg-danger" />

                  <div className="flex items-start gap-2.5 ps-2">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-danger-soft flex items-center justify-center">
                      <AlertCircle className="h-4 w-4 text-danger" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-danger">
                        {t("connections.connectionError", "Connection Error")}
                      </p>
                      <p className="text-xs text-danger/80 mt-0.5 leading-relaxed">
                        {localState.error}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={onReconnect}
                          className="inline-flex items-center gap-1 text-xs font-medium text-danger hover:text-danger bg-danger-soft hover:bg-danger-soft/70 px-2.5 py-1 rounded-md transition-all duration-200"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t("common.retry")}
                        </button>
                        <button
                          onClick={onClearError}
                          className="text-xs text-danger hover:text-danger transition-colors"
                        >
                          {t("common.dismiss")}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={onClearError}
                      className="flex-shrink-0 p-1 rounded-full hover:bg-danger-soft text-danger hover:text-danger transition-all"
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
          <div className="flex w-full items-center justify-end gap-2 border-t border-line/80 pt-3 sm:w-auto sm:border-0 sm:pt-0">
            {/* Keep routine actions visible; destructive disconnect stays in More. */}
            {connection.status === "disconnected" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onReconnect}
                disabled={localState.isConnecting}
                className="border-accent/30 text-accent hover:border-accent/30 hover:bg-accent-soft"
              >
                {localState.isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Power className="h-4 w-4 me-1.5" />
                    {t("connections.reconnect")}
                  </>
                )}
              </Button>
            ) : connection.status === "pending" ? (
              <Button
                size="sm"
                onClick={onViewQr}
                disabled={localState.isDisconnecting}
                className="gap-2 bg-primary text-on-primary hover:bg-primary-hover"
              >
                {localState.qrCode ? (
                  <QrCode className="h-4 w-4" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {localState.qrCode
                  ? t("connections.viewQrCode", "View QR code")
                  : t("connections.viewSetup", "View setup")}
              </Button>
            ) : null}

            {/* 3-dot menu */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMenu(!showMenu)}
                className="h-8 w-8 p-0"
                aria-label={t("connections.moreActionsFor", {
                  defaultValue: "More actions for {{name}}",
                  name: connection.name,
                })}
                title={t("connections.moreActions", "More actions")}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute end-0 mt-2 w-44 bg-surface border border-line rounded-xl shadow-xl z-20 py-1.5 animate-fade-in">
                    <button
                      className="w-full px-3.5 py-2.5 text-start text-sm text-fg hover:bg-muted flex items-center gap-2.5 transition-colors"
                      onClick={() => {
                        onStartEdit();
                        setShowMenu(false);
                      }}
                    >
                      <Edit2 className="h-4 w-4 text-fg-subtle" />
                      {t("connections.rename")}
                    </button>
                    {connection.status === "connected" ? (
                      <button
                        className="w-full px-3.5 py-2.5 text-start text-sm text-warning hover:bg-warning-soft flex items-center gap-2.5 transition-colors"
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
                        {t("connections.disconnect")}
                      </button>
                    ) : connection.status === "pending" ? (
                      <button
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-start text-sm text-warning transition-colors hover:bg-warning-soft"
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
                        {t("connections.cancelSetup")}
                      </button>
                    ) : (
                      <button
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-start text-sm text-accent transition-colors hover:bg-accent-soft"
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
                        {t("connections.reconnect")}
                      </button>
                    )}
                    <div className="my-1.5 border-t border-line" />
                    <button
                      className="w-full px-3.5 py-2.5 text-start text-sm text-danger hover:bg-danger-soft flex items-center gap-2.5 transition-colors"
                      onClick={() => {
                        setDeleteOpen(true);
                        setShowMenu(false);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("connections.archiveUnlink", "Archive & unlink")}
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
        title={t("connections.archiveUnlinkConfirm", {
          defaultValue: "Archive and unlink {{name}}?",
          name: connection.name,
        })}
        description={t(
          "connections.archiveUnlinkDescription",
          "This logs the device out of WhatsApp and hides the account from active connections. Conversations, assignments, and notes are retained and will return if this number is linked again.",
        )}
        confirmText={t("connections.archiveUnlink", "Archive & unlink")}
        onConfirm={async () => {
          await onDelete();
          setDeleteOpen(false);
        }}
        isDestructive
      />
    </div>
  );
}
