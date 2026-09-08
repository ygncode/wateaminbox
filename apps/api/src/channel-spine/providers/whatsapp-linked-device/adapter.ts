import type {
  CapabilityContext,
  ChannelActionIntent,
  ChannelAdapter,
  OutboundMessageIntent,
  ProviderActionResult,
  ProviderIngress,
  ProviderSendResult,
  ResolvedCapabilities,
} from "@wateaminbox/shared";

export interface LinkedDeviceAdapterPort {
  send(intent: OutboundMessageIntent): Promise<ProviderSendResult>;
  perform(action: ChannelActionIntent): Promise<ProviderActionResult>;
}

export class WhatsAppLinkedDeviceAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "whatsapp_linked_device" as const;

  constructor(private readonly port?: LinkedDeviceAdapterPort) {}

  async verifyAndNormalizeIngress(_input: ProviderIngress): Promise<never> {
    throw new Error(
      "Linked-device events use the trusted NATS adapter, not HTTP ingress",
    );
  }

  async resolveCapabilities(
    _context: CapabilityContext,
  ): Promise<ResolvedCapabilities> {
    return linkedDeviceCapabilities();
  }

  async send(intent: OutboundMessageIntent): Promise<ProviderSendResult> {
    if (!this.port) {
      return { outcome: "permanent_failure", errorCode: "adapter_not_wired" };
    }
    return this.port.send(intent);
  }

  async perform(action: ChannelActionIntent): Promise<ProviderActionResult> {
    if (!this.port) {
      return { outcome: "permanent_failure", errorCode: "adapter_not_wired" };
    }
    return this.port.perform(action);
  }
}

export function linkedDeviceCapabilities(): ResolvedCapabilities {
  return {
    typing: true,
    readReceipts: true,
    reactions: true,
    messageEditing: false,
    messageDeletion: true,
    templates: false,
    groups: true,
    multipleRecipients: false,
    outboundInitiation: true,
    scheduledMessages: true,
    messageTypes: [
      { type: "text", enabled: true },
      { type: "image", enabled: true, attachment: { maxCount: 30 } },
      { type: "video", enabled: true, attachment: { maxCount: 30 } },
      { type: "audio", enabled: true, attachment: { maxCount: 1 } },
      { type: "document", enabled: true, attachment: { maxCount: 1 } },
      { type: "sticker", enabled: true, attachment: { maxCount: 1 } },
      { type: "location", enabled: true },
      { type: "contact", enabled: true },
    ],
    actions: {
      reply: true,
      quote: true,
      forward: true,
      retry: true,
      starLocally: true,
      deleteLocally: true,
      deleteForEveryone: true,
      groupMentions: true,
      remoteHistory: true,
    },
    attachment: { enabled: true, maxCount: 30 },
    constraints: {
      providerSideEditing: false,
      deliverySummary: "monotonic_single_recipient",
    },
    unavailableReasons: {
      messageEditing: {
        code: "linked_device_edit_unsupported",
        message: "Message editing is not available for linked devices",
      },
      templates: {
        code: "linked_device_templates_unsupported",
        message: "Templates are not used by linked devices",
      },
      multipleRecipients: {
        code: "one_conversation_per_send",
        message: "Use bulk jobs for several recipients",
      },
    },
    version: "whatsapp-linked-device:v1",
  };
}
