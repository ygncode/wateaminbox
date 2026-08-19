import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { productAnalytics } from "@/lib/product-analytics";
import { useTranslation } from "react-i18next";

/**
 * Authenticated analytics preference control (Settings → Privacy &
 * analytics). Rendered only when the deployer configured GA; lets a visitor
 * grant or withdraw analytics consent for this browser at any time.
 */
export function AnalyticsPreferences() {
  const { t } = useTranslation();

  const consent = useSyncExternalStore(
    productAnalytics.subscribe,
    productAnalytics.getConsent,
  );

  if (!productAnalytics.isConfigured()) return null;

  const consentRequired = productAnalytics.isConsentRequired();
  const collecting =
    !productAnalytics.isReloadRequired() &&
    (consent === "granted" || (!consentRequired && consent !== "denied"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dce3de] bg-[#f8faf8] p-4 dark:border-dark-border dark:bg-dark-tertiary/35">
        <div>
          <p className="text-sm font-semibold">
            {collecting
              ? t(
                  "analytics.statusOn",
                  "Anonymous analytics is on for this browser",
                )
              : t(
                  "analytics.statusOff",
                  "Anonymous analytics is off for this browser",
                )}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
            {consentRequired
              ? t(
                  "analytics.storedLocally",
                  "Your choice is stored only in this browser.",
                )
              : t(
                  "analytics.defaultOnHint",
                  "This deployment enables analytics by default (operator policy); you can still opt this browser out.",
                )}
          </p>
        </div>
        {collecting ||
        (consent === "granted" && productAnalytics.isReloadRequired()) ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => productAnalytics.setConsent("denied")}
          >
            {t("analytics.optOut", "Opt out")}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => productAnalytics.setConsent("granted")}
            className="bg-[#0b7a55] text-white hover:bg-[#096747]"
          >
            {t("analytics.optIn", "Opt in")}
          </Button>
        )}
      </div>

      {consent === "granted" && productAnalytics.isReloadRequired() && (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
          {t(
            "analytics.sessionOffHint",
            "Analytics stays fully off for the rest of this session; it resumes after your next page reload.",
          )}
        </p>
      )}

      <p className="text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
        {t(
          "analytics.onHint",
          "When on, this deployment reports anonymous page views and product events (for example “message sent” or “workspace created”) to its own Google Analytics property. Messages, contacts, names, email addresses, and workspace identifiers are never sent. Opting out takes effect immediately and also removes Google Analytics cookies where possible.",
        )}
      </p>
    </div>
  );
}
