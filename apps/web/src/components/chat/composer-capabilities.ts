import type { ResolvedCapabilities } from "@wateaminbox/shared";
import { createContext, useContext } from "react";

export interface ComposerFeatures {
  canComposeText: boolean;
  canAttach: boolean;
  canSchedule: boolean;
  canSendTyping: boolean;
  canMentionGroups: boolean;
  maxTextLength?: number;
  attachmentTypes: string[];
  acceptedContentTypes?: string[];
}

/**
 * Converts the server's adapter contract into conservative composer switches.
 * Missing or disabled descriptors never become enabled through a broad channel
 * assumption; the server remains the source of truth.
 */
export function resolveComposerFeatures(
  capabilities: ResolvedCapabilities,
): ComposerFeatures {
  const text = capabilities.messageTypes.find(({ type }) => type === "text");
  const attachmentTypes = capabilities.messageTypes
    .filter(
      (descriptor) => descriptor.enabled && Boolean(descriptor.attachment),
    )
    .map(({ type }) => type);

  return {
    canComposeText: Boolean(text?.enabled && !text.templateRequired),
    canAttach: capabilities.attachment.enabled && attachmentTypes.length > 0,
    canSchedule: capabilities.scheduledMessages,
    canSendTyping: capabilities.typing,
    canMentionGroups: capabilities.actions.groupMentions,
    maxTextLength: text?.maxTextLength,
    attachmentTypes,
    acceptedContentTypes: capabilities.attachment.acceptedContentTypes,
  };
}

/**
 * Permissive defaults for the legacy WhatsApp linked-device composer, which
 * predates the adapter contract. Neutral channel accounts always override this
 * with a server-resolved descriptor through `ComposerFeaturesContext`.
 */
export const LEGACY_COMPOSER_FEATURES: ComposerFeatures = {
  canComposeText: true,
  canAttach: true,
  canSchedule: true,
  canSendTyping: true,
  canMentionGroups: true,
  attachmentTypes: ["image", "document"],
};

export const ComposerFeaturesContext = createContext<ComposerFeatures>(
  LEGACY_COMPOSER_FEATURES,
);

/** The capability switches that apply to the composer being rendered. */
export function useComposerFeatures(): ComposerFeatures {
  return useContext(ComposerFeaturesContext);
}
