import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChannelAccountBadge,
  ChannelAvatarBadge,
  ChannelBadge,
} from "./ChannelIdentity";

describe("channel identity badges", () => {
  test("channel badges retain an accessible name in icon-only mode", () => {
    const html = renderToStaticMarkup(
      <ChannelBadge channel="telegram" compact iconOnly />,
    );
    expect(html).toContain('aria-label="Telegram channel"');
    expect(html).toContain("TG");
  });

  test("account badges combine channel, account, and status identity", () => {
    const html = renderToStaticMarkup(
      <ChannelAccountBadge
        account={{
          id: "account-1",
          channel: "email",
          displayName: "Support",
          externalAccountId: "support@example.com",
          status: "connected",
        }}
      />,
    );
    expect(html).toContain("Email account: Support, connected");
    expect(html).toContain("Support");
  });

  test("avatar badges draw the provider's own mark, named for a screen reader", () => {
    const html = renderToStaticMarkup(<ChannelAvatarBadge channel="telegram" />);
    expect(html).toContain('aria-label="Telegram channel"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("TG");
  });

  test("avatar badges fall back to the lettered badge for an undrawn channel", () => {
    const html = renderToStaticMarkup(<ChannelAvatarBadge channel="viber" />);
    expect(html).toContain('aria-label="Viber channel"');
    expect(html).toContain("VI");
  });
});
