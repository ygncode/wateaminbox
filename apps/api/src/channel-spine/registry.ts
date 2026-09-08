import { ChannelAdapterRegistry } from "./application/adapter-registry.js";
import { WhatsAppLinkedDeviceAdapter } from "./providers/whatsapp-linked-device/adapter.js";

/** Composition root: provider imports are intentionally confined to this layer. */
export const channelAdapterRegistry = new ChannelAdapterRegistry();
channelAdapterRegistry.register(new WhatsAppLinkedDeviceAdapter());
