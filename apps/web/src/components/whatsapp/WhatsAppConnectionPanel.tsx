import { useEffect, useState } from "react";
import {
  useWhatsAppConnection,
  type WhatsAppConnectionState,
} from "@/hooks/useWhatsAppConnection";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WhatsAppConnectionPanelProps {
  className?: string;
  compact?: boolean;
}

/**
 * WhatsApp Connection Panel
 * Displays QR code for linking device and connection status
 */
export function WhatsAppConnectionPanel({
  className,
  compact = false,
}: WhatsAppConnectionPanelProps) {
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
        Math.floor((qrExpiresAt.getTime() - Date.now()) / 1000),
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
        <QRCodeView
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

function QRCodeView({
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
