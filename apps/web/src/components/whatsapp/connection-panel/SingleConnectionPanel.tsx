import { nowMs } from "@wateaminbox/shared";
import { AlertCircle, Loader2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhatsAppConnection } from "@/hooks/useWhatsAppConnection";
import { cn, formatPhoneNumber } from "@/lib/utils";
import {
  getStateLabel,
  StatusBadge,
  StatusIndicator,
} from "../ConnectionStatus";
import {
  ConnectedView,
  ConnectingView,
  DisconnectedView,
  ErrorView,
  LegacyQRCodeView,
} from "../ConnectionViews";
import type { SingleConnectionPanelProps } from "./types";
import { useTranslation } from "react-i18next";

/**
 * Single connection panel for legacy mode (one WhatsApp connection)
 */
export function SingleConnectionPanel({
  className,
  compact = false,
}: SingleConnectionPanelProps) {
  const { t } = useTranslation();

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
    if (compact) {
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      );
    }

    return (
      <div
        className={cn(
          "rounded-lg border border-gray-200 bg-white p-6 dark:border-dark-border dark:bg-dark-elevated",
          className,
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div>
              <Skeleton className="h-5 w-44" />
              <Skeleton className="mt-2 h-3.5 w-52 max-w-[50vw]" />
            </div>
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex flex-col items-center py-8">
          <Skeleton className="size-16 rounded-2xl" />
          <Skeleton className="mt-5 h-5 w-40" />
          <Skeleton className="mt-2 h-3.5 w-64 max-w-full" />
          <Skeleton className="mt-6 h-9 w-32 rounded-lg" />
        </div>
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
            ? formatPhoneNumber(phoneNumber) || "Connected"
            : getStateLabel(state, t)}
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
              {t("connections.singleTitle", "WhatsApp Connection")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
              {t(
                "connections.singleHint",
                "Link your WhatsApp Business account",
              )}
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
