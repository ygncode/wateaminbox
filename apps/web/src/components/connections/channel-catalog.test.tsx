import { describe, expect, test } from "bun:test";
import type { ChannelProviderAvailability } from "@/lib/api/channel-accounts";
import {
  CHANNEL_CATALOG,
  catalogEntryForAccount,
  channelUnavailableReason,
} from "./channel-catalog";

const entry = (key: string) => {
  const found = CHANNEL_CATALOG.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No catalog entry: ${key}`);
  return found;
};

const AVAILABLE: ChannelProviderAvailability[] = [
  {
    channel: "whatsapp",
    provider: "whatsapp_linked_device",
    available: true,
    unavailableReason: null,
  },
  {
    channel: "telegram",
    provider: "telegram_bot",
    available: true,
    unavailableReason: null,
  },
];

describe("channel catalog", () => {
  test("offers every channel the spine models, with the two built adapters live", () => {
    expect(
      CHANNEL_CATALOG.filter((candidate) => candidate.implemented).map(
        (candidate) => candidate.provider,
      ),
    ).toEqual(["whatsapp_linked_device", "telegram_bot"]);
    // A placeholder must never claim a provider, or the picker would try to
    // start a connect flow that does not exist.
    expect(
      CHANNEL_CATALOG.filter((candidate) => !candidate.implemented).every(
        (candidate) => candidate.provider === null,
      ),
    ).toBe(true);
  });

  test("matches a connected account to its brand, by provider then channel", () => {
    expect(catalogEntryForAccount("telegram", "telegram_bot")?.name).toBe(
      "Telegram Bot",
    );
    expect(
      catalogEntryForAccount("whatsapp", "whatsapp_linked_device")?.name,
    ).toBe("WhatsApp Web");
    // An adapter this build does not list still renders under its channel,
    // and WhatsApp now holds two entries. The fallback has to land on the one
    // that can actually be connected: an account that exists was connected
    // through something real, never through a coming-soon tile.
    expect(catalogEntryForAccount("whatsapp", "meta_cloud")?.name).toBe(
      "WhatsApp Web",
    );
    expect(catalogEntryForAccount("sms", "twilio")).toBeUndefined();
  });
});

describe("channelUnavailableReason", () => {
  test("clears a provider the workspace reports as available", () => {
    expect(
      channelUnavailableReason(entry("telegram_bot"), AVAILABLE, false),
    ).toBeNull();
  });

  test("surfaces the server's own reason rather than a generic one", () => {
    expect(
      channelUnavailableReason(
        entry("telegram_bot"),
        [
          AVAILABLE[0]!,
          {
            channel: "telegram",
            provider: "telegram_bot",
            available: false,
            unavailableReason: "Channel storage indexes are not ready",
          },
        ],
        false,
      ),
    ).toBe("Channel storage indexes are not ready");
  });

  test("fails closed while loading, on a missing list, and on a silent list", () => {
    expect(
      channelUnavailableReason(entry("telegram_bot"), AVAILABLE, true),
    ).toBe("Checking availability");
    expect(
      channelUnavailableReason(entry("telegram_bot"), undefined, false),
    ).toBe("Unavailable for this workspace");
    expect(
      channelUnavailableReason(entry("telegram_bot"), [AVAILABLE[0]!], false),
    ).toBe("Unavailable for this workspace");
  });

  test("never clears a provider that has no adapter, however available it looks", () => {
    expect(
      channelUnavailableReason(
        entry("instagram"),
        [
          ...AVAILABLE,
          {
            channel: "instagram",
            provider: "meta_cloud",
            available: true,
            unavailableReason: null,
          },
        ],
        false,
      ),
    ).toBe("Planned");
  });
});

describe("inbox account marks", () => {
  test("every account the scope selector can list resolves to a brand mark", () => {
    // The selector previously listed accounts as bare text, so a WhatsApp
    // number and a Telegram bot were indistinguishable. Each row needs an
    // entry to draw, and the two live adapters must always have one.
    expect(
      catalogEntryForAccount("whatsapp", "whatsapp_linked_device"),
    ).toBeDefined();
    expect(catalogEntryForAccount("telegram", "telegram_bot")).toBeDefined();
    for (const entry of CHANNEL_CATALOG) {
      expect(typeof entry.Mark).toBe("function");
      expect(entry.tileClassName.length).toBeGreaterThan(0);
    }
  });
});
