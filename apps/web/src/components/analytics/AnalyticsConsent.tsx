import { useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { Button } from "@/components/ui";
import {
  type ConsentDecision,
  productAnalytics,
} from "@/lib/product-analytics";
import { useTranslation } from "react-i18next";

/**
 * First-party analytics choice, shown only when the deployer enabled GA,
 * consent is required, and this browser has not decided yet. gtag.js is not
 * injected before acceptance; a decline persists and sends nothing.
 */
export function AnalyticsConsent() {
  const { t } = useTranslation();

  const location = useLocation();
  const consent = useSyncExternalStore(
    productAnalytics.subscribe,
    productAnalytics.getConsent,
  );

  if (
    !productAnalytics.isConfigured() ||
    !productAnalytics.isConsentRequired() ||
    consent !== "unknown"
  ) {
    return null;
  }

  const decide = (decision: ConsentDecision) => {
    productAnalytics.setConsent(decision);
    if (decision === "granted") {
      // Pre-consent calls are discarded, so report the page now in view.
      productAnalytics.trackPage(location.pathname);
    }
  };

  return (
    <section
      aria-label={t("analytics.consent", "Analytics consent")}
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-[#dce3de] bg-white p-4 shadow-[0_12px_40px_rgba(16,33,27,.14)] dark:border-dark-border dark:bg-dark-elevated sm:right-6 sm:left-auto sm:mx-0"
    >
      <h2 className="text-sm font-semibold">
        {t("analytics.anonymousUsage", "Anonymous usage analytics")}
      </h2>
      <p className="mt-1.5 text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
        {t(
          "analytics.consentBody",
          "This deployment can collect anonymous page and feature usage through Google Analytics to improve the product. No messages, contacts, or account identifiers are ever sent. You can change this choice anytime in Settings under Privacy &amp; analytics.",
        )}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => decide("denied")}
        >
          Decline
        </Button>
        <Button
          type="button"
          onClick={() => decide("granted")}
          className="bg-[#0b7a55] text-white hover:bg-[#096747]"
        >
          Accept
        </Button>
      </div>
    </section>
  );
}
