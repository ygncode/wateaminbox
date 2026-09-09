import type { Channel, ChannelProvider } from "@wateaminbox/shared";
import type { ChannelProviderAvailability } from "@/lib/api/channel-accounts";
import type { ComponentType } from "react";
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
    key: "whatsapp_linked_device",
    name: "WhatsApp",
    channel: "whatsapp",
    provider: "whatsapp_linked_device",
    Mark: WhatsAppMark,
    tileClassName: "bg-[#25D366] text-white",
    implemented: true,
  },
  {
    key: "telegram_bot",
    name: "Telegram",
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

/** The catalog entry that owns a connected account, for list rendering. */
export function catalogEntryForAccount(
  channel: string,
  provider: string,
): ChannelCatalogEntry | undefined {
  return (
    CHANNEL_CATALOG.find((entry) => entry.provider === provider) ??
    CHANNEL_CATALOG.find((entry) => entry.channel === channel)
  );
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
