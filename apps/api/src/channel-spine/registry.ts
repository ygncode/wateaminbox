import { ChannelAdapterRegistry } from "./application/adapter-registry.js";
import { resolveTelegramWebhookSecret } from "../services/channel-credential.service.js";
import { TelegramBotAdapter } from "./providers/telegram-bot/adapter.js";
import { TelegramBotApiTransport } from "./providers/telegram-bot/transport.js";
import { WhatsAppLinkedDeviceAdapter } from "./providers/whatsapp-linked-device/adapter.js";
import { LinkedDeviceNatsTransport } from "./providers/whatsapp-linked-device/transport.js";

/** Composition root: provider imports are intentionally confined to this layer. */
export const channelAdapterRegistry = new ChannelAdapterRegistry();
channelAdapterRegistry.register(
  new WhatsAppLinkedDeviceAdapter(new LinkedDeviceNatsTransport()),
);
channelAdapterRegistry.register(
  new TelegramBotAdapter({
    resolveWebhookSecret: resolveTelegramWebhookSecret,
    outboundTransport: new TelegramBotApiTransport(),
  }),
);
