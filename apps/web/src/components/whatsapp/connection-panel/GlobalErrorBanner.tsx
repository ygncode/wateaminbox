import { X, Zap } from "lucide-react";
import type { GlobalErrorBannerProps } from "./types";
import { useTranslation } from "react-i18next";

/**
 * Global error banner for connection limit and other critical errors
 */
export function GlobalErrorBanner({
  error,
  billingUrl,
  onDismiss,
}: GlobalErrorBannerProps) {
  const { t } = useTranslation();

  return (
    <div role="alert" className="mb-6 animate-slide-down">
      <div className="relative overflow-hidden rounded-xl border border-warning/30 bg-warning-soft p-4 shadow-lg">
        {/* Decorative shimmer overlay */}
        <div className="absolute inset-0 animate-shimmer opacity-30 pointer-events-none" />

        <div className="relative flex items-start gap-4">
          {/* Animated icon with pulse ring */}
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 rounded-full bg-warning/20 animate-pulse-ring" />
            <div className="relative w-12 h-12 rounded-full bg-warning flex items-center justify-center shadow-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>

          <div className="flex-1 pt-1">
            <h3 className="text-base font-semibold text-warning">
              {t("connections.limitReached", "Connection Limit Reached")}
            </h3>
            <p className="text-sm text-warning/90 mt-1 leading-relaxed">
              {error}
            </p>
            <div className="mt-3 flex items-center gap-3">
              {billingUrl && (
                <>
                  <a
                    href={billingUrl}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-warning hover:text-warning bg-warning-soft/50 hover:bg-warning-soft px-3 py-1.5 rounded-full transition-all duration-200"
                  >
                    {t("connections.upgradePlan", "Upgrade Plan")}
                  </a>
                  <span className="text-warning">•</span>
                </>
              )}
              <button
                type="button"
                onClick={onDismiss}
                className="text-xs text-warning hover:text-warning transition-colors"
              >
                {t("common.dismiss")}
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            type="button"
            aria-label={t("common.dismiss", "Dismiss")}
            onClick={onDismiss}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-warning-soft/50 text-warning hover:text-warning transition-all duration-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
