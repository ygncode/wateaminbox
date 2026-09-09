import type { Channel, ChannelProvider } from "@wateaminbox/shared";
import type { ComponentType } from "react";
import type { ChannelProviderAvailability } from "@/lib/api/channel-accounts";
import {
  EmailMark,
  InstagramMark,
  LineMark,
  MessengerMark,
  TelegramMark,
  WhatsAppMark,
} from "./channel-icons";

export interface ChannelCatalogEntry {
  /** Stable key; also the value the picker reports on select. */
  key: string;
  name: string;
  channel: Channel;
  provider: ChannelProvider | null;
  Mark: ComponentType<{ className?: string }>;
  /** Tile background, so each provider keeps its own brand colour. */
  tileClassName: string;
  /**
   * `false` for providers the RFC names but no adapter implements yet. They
   * are shown greyed rather than hidden: the roadmap is part of what the page
   * communicates, and a picker that lists only two apps reads as broken.
   */
  implemented: boolean;
  /** Short line under an unimplemented provider. */
  note?: string;
}

/**
 * Everything the product can or will connect, in the order the picker shows.
 *
 * WhatsApp and Telegram are real; the rest are placeholders for the providers
 * the channel-neutral spine was designed around. Whether an implemented
 * provider can actually be connected *right now* is a workspace question,
 * answered by GET /channel-accounts/providers - not by this list.
 */
export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    // Named for how it connects, not for the app. A workspace links a phone
    // the way WhatsApp Web does, which is a different product decision from
    // the official Business API below - and the difference matters enough
    // (one phone, no template messaging) that the picker should not blur it.
    key: "whatsapp_linked_device",
    name: "WhatsApp Web",
    channel: "whatsapp",
    provider: "whatsapp_linked_device",
    Mark: WhatsAppMark,
    tileClassName: "bg-[#25D366] text-white",
    implemented: true,
  },
  {
    key: "whatsapp_cloud_api",
    name: "WhatsApp Business",
    channel: "whatsapp",
    provider: null,
    Mark: WhatsAppMark,
    tileClassName: "bg-[#128C7E] text-white",
    implemented: false,
    note: "Coming soon",
  },
  {
    // Telegram offers bots and user accounts; this connects a bot, and a bot
    // cannot see ordinary group messages unless privacy mode is turned off.
    // Saying so on the tile is cheaper than explaining an empty group inbox.
    key: "telegram_bot",
    name: "Telegram Bot",
    channel: "telegram",
    provider: "telegram_bot",
    Mark: TelegramMark,
    tileClassName: "bg-[#2AABEE] text-white",
    implemented: true,
  },
  {
    key: "messenger",
    name: "Messenger",
    channel: "messenger",
    provider: null,
    Mark: MessengerMark,
    tileClassName: "bg-[#0084FF] text-white",
    implemented: false,
    note: "Planned",
  },
  {
    key: "instagram",
    name: "Instagram",
    channel: "instagram",
    provider: null,
    Mark: InstagramMark,
    tileClassName:
      "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white",
    implemented: false,
    note: "Planned",
  },
  {
    key: "line",
    name: "LINE",
    channel: "line",
    provider: null,
    Mark: LineMark,
    tileClassName: "bg-[#06C755] text-white",
    implemented: false,
    note: "Planned",
  },
  {
    key: "email",
    name: "Email",
    channel: "email",
    provider: null,
    Mark: EmailMark,
    tileClassName: "bg-[#5B6B79] text-white",
    implemented: false,
    note: "Planned",
  },
];

/**
 * The catalog entry that owns a connected account, for list rendering.
 *
 * Exact provider first. Falling back to the channel is for an adapter this
 * build does not list yet, and a channel can hold more than one entry - a
 * WhatsApp account may be linked-device or the Business API - so the fallback
 * prefers an entry that is actually implemented rather than whichever happens
 * to come first. An account that exists was connected through something real.
 */
export function catalogEntryForAccount(
  channel: string,
  provider: string,
): ChannelCatalogEntry | undefined {
  const byProvider = CHANNEL_CATALOG.find(
    (entry) => entry.provider === provider,
  );
  if (byProvider) return byProvider;
  const sameChannel = CHANNEL_CATALOG.filter(
    (entry) => entry.channel === channel,
  );
  return sameChannel.find((entry) => entry.implemented) ?? sameChannel[0];
}

/**
 * Why a provider cannot be picked, or `null` when it can.
 *
 * Kept free of React so the rule that decides what the grid offers is
 * testable on its own: it is the difference between a picker that explains
 * itself and one that accepts a click and then fails at submit.
 *
 * Fails closed. An availability list that is still loading, missing, or
 * silent about a provider never yields "available".
 */
export function channelUnavailableReason(
  entry: ChannelCatalogEntry,
  availability: ChannelProviderAvailability[] | undefined,
  isLoading: boolean,
): string | null {
  if (!entry.implemented) return entry.note ?? "Not available yet";
  if (isLoading) return "Checking availability";
  const record = availability?.find(
    (candidate) => candidate.provider === entry.provider,
  );
  if (!record) return "Unavailable for this workspace";
  if (record.available) return null;
  return record.unavailableReason ?? "Unavailable for this workspace";
}

/** Human name for a channel, for prose the user reads. */
export function channelDisplayName(channel: string): string {
  return (
    CHANNEL_CATALOG.find((entry) => entry.channel === channel)?.name ?? channel
  );
}
