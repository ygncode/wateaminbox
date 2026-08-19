import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { nowMs } from "@wateaminbox/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  const [localCountdown, setLocalCountdown] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrError, setQrError] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);

  const size = small ? 128 : 200;

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

  // Generate QR code locally using canvas
  useEffect(() => {
    if (!qrCode || !canvasRef.current) return;

    setIsGenerating(true);
    setQrError(false);

    QRCode.toCanvas(canvasRef.current, qrCode, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(() => setIsGenerating(false))
      .catch(() => {
        setQrError(true);
        setIsGenerating(false);
      });
  }, [qrCode, size]);

  const displayCountdown = countdown !== undefined ? countdown : localCountdown;

  return (
    <div className="relative inline-block">
      <div
        className={cn(
          "p-2 bg-white border rounded-lg",
          small ? "border-gray-200" : "border-2 border-gray-200",
        )}
      >
        {isGenerating && !qrError && (
          <div
            className={cn(
              "flex items-center justify-center",
              small ? "w-32 h-32" : "w-48 h-48",
            )}
          >
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}
        {qrError && (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2",
              small ? "w-32 h-32" : "w-48 h-48",
            )}
          >
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="text-xs text-red-600 text-center">
              {t("connections.qrGenerateFailed", "Failed to generate QR")}
            </p>
            <Button size="sm" variant="outline" onClick={onRefresh}>
              Retry
            </Button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={cn(
            small ? "w-32 h-32" : "w-48 h-48",
            (isGenerating || qrError) && "hidden",
          )}
        />
        {displayCountdown <= 30 && displayCountdown > 0 && !qrError && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-orange-600 font-medium text-sm">
                {t("connections.expiring", "Expiring")}
              </p>
              <p className="text-xl font-bold text-gray-900">
                {displayCountdown}s
              </p>
            </div>
          </div>
        )}
        {displayCountdown === 0 && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-red-600 font-medium text-sm mb-1">
                {t("connections.expired", "Expired")}
              </p>
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
