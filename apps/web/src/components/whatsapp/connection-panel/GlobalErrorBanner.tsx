import { X, Zap } from "lucide-react";
import type { GlobalErrorBannerProps } from "./types";
import { useTranslation } from "react-i18next";

/**
 * Global error banner for connection limit and other critical errors
 */
export function GlobalErrorBanner({
  error,
  onDismiss,
}: GlobalErrorBannerProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-6 animate-slide-down">
      <div className="relative overflow-hidden rounded-xl border border-amber-300/50 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/30 p-4 shadow-lg">
        {/* Decorative shimmer overlay */}
        <div className="absolute inset-0 animate-shimmer opacity-30 pointer-events-none" />

        <div className="relative flex items-start gap-4">
          {/* Animated icon with pulse ring */}
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-pulse-ring" />
            <div className="relative w-12 h-12 rounded-full bg-amber-500 flex items-center justify-center shadow-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>

          <div className="flex-1 pt-1">
            <h3 className="text-base font-semibold text-amber-900 dark:text-amber-300">
              {t("connections.limitReached", "Connection Limit Reached")}
            </h3>
            <p className="text-sm text-amber-700/90 dark:text-amber-400/90 mt-1 leading-relaxed">
              {error}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 bg-amber-200/50 dark:bg-amber-800/50 hover:bg-amber-200 dark:hover:bg-amber-700/50 px-3 py-1.5 rounded-full transition-all duration-200">
                {t("connections.upgradePlan", "Upgrade Plan")}
              </button>
              <span className="text-amber-400">•</span>
              <button
                onClick={onDismiss}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-all duration-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
