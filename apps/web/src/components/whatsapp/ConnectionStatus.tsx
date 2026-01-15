import { Loader2, QrCode, Wifi, WifiOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { WhatsAppConnectionState } from "@/hooks/useWhatsAppConnection";

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

/**
 * Get human-readable label for connection state
 */
export function getStateLabel(state: WhatsAppConnectionState): string {
  const labels: Record<WhatsAppConnectionState, string> = {
    disconnected: "Not connected",
    connecting: "Connecting…",
    waiting_qr: "Waiting for QR…",
    scanning: "Scan QR code",
    connected: "Connected",
    error: "Connection error",
  };
  return labels[state];
}
