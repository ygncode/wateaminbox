import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { nowMs } from "@whatsapp-web/shared";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface QRCodeDisplayProps {
  qrCode: string;
  expiresAt: Date | null;
  countdown?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  small?: boolean;
}

/**
 * QR Code Display Component
 * Shows a QR code with expiry countdown and refresh functionality
 */
export function QRCodeDisplay({
  qrCode,
  expiresAt,
  countdown,
  onRefresh,
  isRefreshing,
  small = false,
}: QRCodeDisplayProps) {
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
        Math.floor((expiresAt.getTime() - nowMs()) / 1000),
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
          small ? "border-gray-200" : "border-2 border-gray-200",
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
