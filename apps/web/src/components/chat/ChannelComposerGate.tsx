import type { ResolvedCapabilities } from "@wateaminbox/shared";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { resolveComposerFeatures } from "./composer-capabilities";

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
  if (isLoading) {
    return (
      <div
        className="h-12 animate-pulse border-t border-gray-100 bg-gray-50 dark:border-dark-border dark:bg-dark-tertiary"
        role="status"
        aria-label="Loading channel capabilities"
      />
    );
  }

  const features = capabilities ? resolveComposerFeatures(capabilities) : null;
  if (!features?.canComposeText) {
    return (
      <div className="flex items-center gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-dark-border dark:bg-dark-tertiary/50 dark:text-dark-text-secondary">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        <span>Messaging is not available for this channel account</span>
      </div>
    );
  }

  return children;
}
