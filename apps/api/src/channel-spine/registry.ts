import {
  TelegramBotAdapter,
  TelegramBotApiTransport,
} from "@wateaminbox/adapter-telegram";
import { ChannelAdapterRegistry } from "./application/adapter-registry.js";
import {
  ChannelCredentialKeyError,
  resolveTelegramWebhookSecret,
} from "../services/channel-credential.service.js";
import { telegramTransportPorts } from "./providers/telegram-bot/ports.js";
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
    isCredentialUnavailable: (error) =>
      error instanceof ChannelCredentialKeyError,
    outboundTransport: new TelegramBotApiTransport(telegramTransportPorts),
  }),
);
