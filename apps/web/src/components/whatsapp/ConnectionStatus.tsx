import { Loader2, QrCode, Wifi, WifiOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WhatsAppConnectionState } from "@/hooks/useWhatsAppConnection";
import { useTranslation } from "react-i18next";

/**
 * Status Indicator Component
 * Small colored dot indicating connection status
 */
export function StatusIndicator({ state }: { state: WhatsAppConnectionState }) {
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

/**
 * Status Badge Component
 * Badge with icon and label indicating connection status
 */
export function StatusBadge({ state }: { state: WhatsAppConnectionState }) {
  const { t } = useTranslation();

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
      label: t("connections.states.disconnected", "Disconnected"),
    },
    connecting: {
      variant: "outline",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: t("connections.states.connecting", "Connecting"),
    },
    waiting_qr: {
      variant: "outline",
      icon: <QrCode className="h-3 w-3" />,
      label: t("connections.states.waitingQr", "Waiting for QR"),
    },
    scanning: {
      variant: "outline",
      icon: <QrCode className="h-3 w-3 animate-pulse" />,
      label: t("connections.states.scanning", "Scan QR Code"),
    },
    connected: {
      variant: "default",
      icon: <Wifi className="h-3 w-3" />,
      label: t("connections.states.connected", "Connected"),
    },
    error: {
      variant: "destructive",
      icon: <XCircle className="h-3 w-3" />,
      label: t("connections.states.error", "Error"),
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

/** Optional translator so this helper stays usable outside React. */
export type StateTranslate = (key: string, fallback: string) => string;

/**
 * Get human-readable label for connection state
 */
export function getStateLabel(
  state: WhatsAppConnectionState,
  t: StateTranslate = (_key, fallback) => fallback,
): string {
  const labels: Record<WhatsAppConnectionState, [key: string, en: string]> = {
    disconnected: ["connections.stateLabels.disconnected", "Not connected"],
    connecting: ["connections.stateLabels.connecting", "Connecting…"],
    waiting_qr: ["connections.stateLabels.waitingQr", "Waiting for QR…"],
    scanning: ["connections.stateLabels.scanning", "Scan QR code"],
    connected: ["connections.stateLabels.connected", "Connected"],
    error: ["connections.stateLabels.error", "Connection error"],
  };
  const [key, fallback] = labels[state];
  return t(key, fallback);
}
