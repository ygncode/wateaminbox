import {
  isChannel,
  isChannelProvider,
  type CapabilityContext,
  type Channel,
  type ChannelAdapter,
  type ChannelProvider,
  type ResolvedCapabilities,
} from "@wateaminbox/shared";

export class ChannelAdapterRegistry {
  readonly #adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (!isChannel(adapter.channel)) {
      throw new Error(
        `Cannot register unsupported channel: ${adapter.channel}`,
      );
    }
    if (!isChannelProvider(adapter.provider)) {
      throw new Error(
        `Cannot register unsupported provider: ${adapter.provider}`,
      );
    }
    const key = adapterKey(adapter.channel, adapter.provider);
    if (this.#adapters.has(key)) {
      throw new Error(
        `Channel adapter already registered: ${adapter.channel}/${adapter.provider}`,
      );
    }
    this.#adapters.set(key, adapter);
  }

  get(channel: Channel, provider: ChannelProvider): ChannelAdapter {
    const adapter = this.#adapters.get(adapterKey(channel, provider));
    if (!adapter) {
      throw new Error(
        `Channel adapter is not registered: ${channel}/${provider}`,
      );
    }
    return adapter;
  }

  has(channel: Channel, provider: ChannelProvider): boolean {
    return this.#adapters.has(adapterKey(channel, provider));
  }
}

export async function resolveAdapterCapabilities(
  registry: ChannelAdapterRegistry,
  channel: Channel,
  provider: ChannelProvider,
  context: CapabilityContext,
): Promise<ResolvedCapabilities> {
  try {
    const capabilities = await registry
      .get(channel, provider)
      .resolveCapabilities(context);
    if (!capabilities.version.trim()) {
      return unavailableCapabilities("invalid-capability-revision");
    }
    return capabilities;
  } catch {
    return unavailableCapabilities("capability-resolution-unavailable");
  }
}

export function unavailableCapabilities(
  reasonCode: string,
): ResolvedCapabilities {
  const reason = {
    code: reasonCode,
    message: "Action availability is unavailable",
  };
  return {
    typing: false,
    readReceipts: false,
    reactions: false,
    messageEditing: false,
    messageDeletion: false,
    templates: false,
    groups: false,
    multipleRecipients: false,
    outboundInitiation: false,
    scheduledMessages: false,
    messageTypes: [],
    actions: {
      reply: false,
      quote: false,
      forward: false,
      retry: false,
      starLocally: true,
      deleteLocally: true,
      deleteForEveryone: false,
      groupMentions: false,
      remoteHistory: false,
    },
    attachment: { enabled: false },
    constraints: {},
    unavailableReasons: {
      typing: reason,
      readReceipts: reason,
      reactions: reason,
      messageEditing: reason,
      messageDeletion: reason,
      templates: reason,
      groups: reason,
      multipleRecipients: reason,
      outboundInitiation: reason,
      scheduledMessages: reason,
    },
    version: `unavailable:${reasonCode}`,
  };
}

function adapterKey(channel: Channel, provider: ChannelProvider): string {
  return `${channel}:${provider}`;
}
