import type { ResolvedCapabilities } from "@wateaminbox/shared";

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
