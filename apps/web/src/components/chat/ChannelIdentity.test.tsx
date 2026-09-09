import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelAccountBadge, ChannelBadge } from "./ChannelIdentity";

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
});
