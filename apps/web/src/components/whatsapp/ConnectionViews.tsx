import { formatAuditTime } from "@wateaminbox/shared";
import {
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhoneNumber } from "@/lib/utils";
import { useTranslation } from "react-i18next";

/**
 * Disconnected View
 * Shows when no WhatsApp device is connected
 */
export function DisconnectedView({
  onConnect,
  isConnecting,
}: {
  onConnect: () => void;
  isConnecting: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
        <Smartphone className="h-10 w-10 text-fg-subtle" />
      </div>
      <h3 className="text-lg font-medium text-fg mb-2">
        {t("connections.connectWhatsapp", "Connect WhatsApp")}
      </h3>
      <p className="text-sm text-fg-muted mb-6 max-w-sm mx-auto">
        {t(
          "connections.connectWhatsappHint",
          "Link your WhatsApp Business account to start receiving and sending messages.",
        )}
      </p>
      <Button
        onClick={onConnect}
        disabled={isConnecting}
        className="bg-primary hover:bg-primary-hover"
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
            {t("connections.connecting")}
          </>
        ) : (
          <>
            <QrCode className="h-4 w-4 me-2" />
            {t("connections.connectDevice", "Connect Device")}
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * Connecting View
 * Shows while establishing connection
 */
export function ConnectingView() {
  const { t } = useTranslation();

  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-info-soft flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-info animate-spin" />
      </div>
      <h3 className="text-lg font-medium text-fg mb-2">
        {t("connections.initializing", "Initializing Connection")}
      </h3>
      <p className="text-sm text-fg-muted">
        {t(
          "connections.initializingHint",
          "Please wait while we prepare the QR code...",
        )}
      </p>
    </div>
  );
}

/**
 * Legacy QR Code View
 * Shows QR code for single connection mode with instructions
 */
export function LegacyQRCodeView({
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
  const { t } = useTranslation();

  return (
    <div className="text-center">
      {/* QR Code Container */}
      <div className="relative inline-block p-4 bg-surface border-2 border-line rounded-xl mb-4">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}`}
          alt={t("connections.qrCodeAlt", "WhatsApp QR Code")}
          className="w-64 h-64"
        />
        {countdown <= 30 && countdown > 0 && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-warning font-medium">
                {t("connections.qrExpiring", "QR Expiring")}
              </p>
              <p className="text-2xl font-bold text-fg">{countdown}s</p>
            </div>
          </div>
        )}
        {countdown === 0 && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-danger font-medium mb-2">
                {t("connections.qrExpired", "QR Expired")}
              </p>
              <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 me-1" />
                    {t("common.refresh")}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="space-y-2 mb-4">
        <h3 className="text-lg font-medium text-fg">
          {t("connections.scanWithWhatsapp", "Scan with WhatsApp")}
        </h3>
        <ol className="text-sm text-fg-muted text-start max-w-xs mx-auto space-y-1">
          <li>{t("connections.step1", "1. Open WhatsApp on your phone")}</li>
          <li>{t("connections.step2", "2. Tap Menu or Settings")}</li>
          <li>{t("connections.step3", "3. Select Linked Devices")}</li>
          <li>{t("connections.step4", "4. Tap Link a Device")}</li>
          <li>
            {t("connections.step5", "5. Point your phone at this screen")}
          </li>
        </ol>
      </div>

      {/* Timer */}
      {countdown > 30 && (
        <p className="text-sm text-fg-subtle">
          QR code expires in {Math.floor(countdown / 60)}:
          {String(countdown % 60).padStart(2, "0")}
        </p>
      )}
    </div>
  );
}

/**
 * Connected View
 * Shows when device is successfully connected
 */
export function ConnectedView({
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
  const { t } = useTranslation();

  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-accent-soft flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-accent" />
      </div>
      <h3 className="text-lg font-medium text-fg mb-1">
        {t("connections.whatsappConnected", "WhatsApp Connected")}
      </h3>
      {phoneNumber && (
        <p className="text-xl font-semibold text-accent mb-2">
          {formatPhoneNumber(phoneNumber)}
        </p>
      )}
      {lastSync && (
        <p className="text-sm text-fg-muted mb-4">
          Last synced: {formatAuditTime(lastSync)}
        </p>
      )}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 me-1" />
          {t("connections.refreshStatus", "Refresh Status")}
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

/**
 * Error View
 * Shows when connection fails
 */
export function ErrorView({
  error,
  onRetry,
  isRetrying,
}: {
  error: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-danger-soft flex items-center justify-center">
        <XCircle className="h-10 w-10 text-danger" />
      </div>
      <h3 className="text-lg font-medium text-fg mb-2">
        {t("connections.failed", "Connection Failed")}
      </h3>
      <p className="text-sm text-fg-muted mb-4 max-w-sm mx-auto">
        {error || t("connections.unableToConnect")}
      </p>
      <Button onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? (
          <>
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
            {t("connections.retrying")}
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 me-2" />
            {t("connections.tryAgain", "Try Again")}
          </>
        )}
      </Button>
    </div>
  );
}
