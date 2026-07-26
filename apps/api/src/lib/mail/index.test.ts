import { describe, expect, mock, test } from "bun:test";
import { LogMailDriver } from "./drivers/log.js";
import { ResendMailDriver } from "./drivers/resend.js";
import { createMailDriver } from "./index.js";

const message = {
  to: "person@example.com",
  subject: "Team invitation",
  html: "<p>Join us</p>",
  text: "Join us: http://localhost/invite/token",
};

describe("mail drivers", () => {
  test("selects drivers by configuration", () => {
    expect(createMailDriver("log")).toBeInstanceOf(LogMailDriver);
    expect(createMailDriver("resend")).toBeInstanceOf(ResendMailDriver);
    expect(() => createMailDriver("unknown")).toThrow(
      'Unsupported MAIL_DRIVER "unknown"',
    );
  });

  test("log driver captures mail as a successful delivery", async () => {
    const result = await new LogMailDriver().send(message);

    expect(result.success).toBe(true);
    expect(result.messageId).toStartWith("log-");
  });

  test("resend driver delegates to the provider", async () => {
    const fetchMock = mock(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ id: "resend-message-id" }),
    );
    const driver = new ResendMailDriver({
      apiKey: "re_test",
      from: "Team <team@example.com>",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await driver.send(message);

    expect(result).toEqual({ success: true, messageId: "resend-message-id" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: "Team <team@example.com>",
      to: message.to,
      subject: message.subject,
    });
  });
});
