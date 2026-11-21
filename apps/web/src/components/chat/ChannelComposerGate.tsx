import type { ResolvedCapabilities } from "@wateaminbox/shared";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ComposerFeaturesContext,
  resolveComposerFeatures,
} from "./composer-capabilities";

interface ChannelComposerGateProps {
  capabilities: ResolvedCapabilities | null | undefined;
  isLoading?: boolean;
  children: ReactNode;
}

/**
 * Fail-closed boundary for a channel-neutral composer. Existing WhatsApp UI is
 * intentionally untouched until it is supplied an authoritative account
 * capability response.
 */
export function ChannelComposerGate({
  capabilities,
  isLoading = false,
  children,
}: ChannelComposerGateProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div
        className="h-12 animate-pulse border-t border-line bg-muted"
        role="status"
        aria-label={t("chat.channelCapabilitiesLoading")}
      />
    );
  }

  const features = capabilities ? resolveComposerFeatures(capabilities) : null;
  if (!features?.canComposeText) {
    return (
      <div className="flex items-center gap-2 border-t border-line bg-subtle px-4 py-3 text-sm text-fg-muted">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        <span>{t("chat.channelMessagingUnavailable")}</span>
      </div>
    );
  }

  // Every control inside the composer reads the same resolved descriptor, so a
  // capability the adapter does not report can never be offered.
  return (
    <ComposerFeaturesContext.Provider value={features}>
      {children}
    </ComposerFeaturesContext.Provider>
  );
}
