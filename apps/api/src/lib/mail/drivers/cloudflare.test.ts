import { describe, expect, mock, test } from "bun:test";
import { CloudflareMailDriver } from "./cloudflare.js";

const message = {
  to: "person@example.com",
  subject: "Team invitation",
  html: "<p>Join us</p>",
  text: "Join us: http://localhost/invite/token",
};

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const SEND_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send`;
// The API returns one RFC Message-ID per send operation.
const MESSAGE_ID = "<aB3xK9mP2qR5sT8uV0wX1yZ4cD6fG7hJ9kL0@example.com>";

type FetchMock = ReturnType<typeof mock>;

function fetchReturning(
  response: () => Response | Promise<Response>,
): FetchMock {
  return mock(async (_input: string | URL | Request, _init?: RequestInit) =>
    response(),
  );
}

function driverWith(
  fetchMock: FetchMock,
  overrides: { accountId?: string; apiToken?: string; from?: string } = {},
): CloudflareMailDriver {
  return new CloudflareMailDriver({
    accountId: overrides.accountId ?? ACCOUNT_ID,
    apiToken: overrides.apiToken ?? "cf_email_token",
    from: overrides.from ?? "WATeamInbox <noreply@example.com>",
    fetch: fetchMock as unknown as typeof fetch,
  });
}

function envelope(
  result: unknown,
  init: ResponseInit & { success?: boolean; errors?: unknown } = {},
): Response {
  const { success = true, errors = [], ...responseInit } = init;
  return Response.json({ success, errors, messages: [], result }, responseInit);
}

/** The documented success shape: one message_id plus the recipient buckets. */
function delivered(to: string, init: ResponseInit = {}): Response {
  return envelope(
    {
      message_id: MESSAGE_ID,
      delivered: [to],
      permanent_bounces: [],
      queued: [],
    },
    init,
  );
}

describe("cloudflare mail driver", () => {
  test("posts the documented request shape to the account send endpoint", async () => {
    const fetchMock = fetchReturning(() =>
      delivered(message.to, { headers: { "cf-ray": "8f0a1b2c3d4e5f60-SIN" } }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SEND_URL);
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer cf_email_token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(request.body))).toEqual({
      // EMAIL_FROM carries a display name, which the REST API takes as an
      // object rather than the SMTP `Name <address>` header form.
      from: { address: "noreply@example.com", name: "WATeamInbox" },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  });

  test("sends a bare sender address unchanged", async () => {
    const fetchMock = fetchReturning(() => delivered(message.to));

    await driverWith(fetchMock, { from: "noreply@example.com" }).send(message);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body)).from).toBe("noreply@example.com");
  });

  test("strips quotes from a quoted display name", async () => {
    const fetchMock = fetchReturning(() => delivered(message.to));

    await driverWith(fetchMock, {
      from: '"WATeamInbox, Support" <noreply@example.com>',
    }).send(message);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body)).from).toEqual({
      address: "noreply@example.com",
      name: "WATeamInbox, Support",
    });
  });

  test("omits an absent text body instead of sending null", async () => {
    const fetchMock = fetchReturning(() => delivered(message.to));

    await driverWith(fetchMock).send({
      to: message.to,
      subject: message.subject,
      html: message.html,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).not.toHaveProperty("text");
  });

  test("returns the API message_id for an immediate delivery", async () => {
    const fetchMock = fetchReturning(() =>
      // The documented identifier wins over the request trace.
      delivered(message.to, { headers: { "cf-ray": "8f0a1b2c3d4e5f60-SIN" } }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({ success: true, messageId: MESSAGE_ID });
  });

  test("treats a queued recipient as a successful send", async () => {
    const fetchMock = fetchReturning(() =>
      envelope({
        message_id: MESSAGE_ID,
        delivered: [],
        permanent_bounces: [],
        queued: [message.to],
      }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({ success: true, messageId: MESSAGE_ID });
  });

  test("falls back to the cf-ray when a response omits message_id", async () => {
    // Off-schema, but a recorded send still needs something to correlate on.
    const fetchMock = fetchReturning(() =>
      envelope(
        { delivered: [message.to], permanent_bounces: [], queued: [] },
        { headers: { "cf-ray": "8f0a1b2c3d4e5f60-SIN" } },
      ),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({
      success: true,
      messageId: "cloudflare-8f0a1b2c3d4e5f60-SIN",
    });
  });

  test("falls back to a timestamp when neither message_id nor cf-ray is present", async () => {
    const fetchMock = fetchReturning(() =>
      envelope({ delivered: [message.to], permanent_bounces: [], queued: [] }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^cloudflare-\d+$/);
  });

  test("ignores a blank or non-string message_id", async () => {
    for (const message_id of ["   ", 42, null]) {
      const fetchMock = fetchReturning(() =>
        envelope(
          { message_id, delivered: [message.to], permanent_bounces: [] },
          { headers: { "cf-ray": "8f0a1b2c3d4e5f60-SIN" } },
        ),
      );

      const result = await driverWith(fetchMock).send(message);

      expect(result).toEqual({
        success: true,
        messageId: "cloudflare-8f0a1b2c3d4e5f60-SIN",
      });
    }
  });

  test("fails on a permanent bounce reported inside a successful envelope", async () => {
    // A bounce still carries a message_id; the send is a failure regardless.
    const fetchMock = fetchReturning(() =>
      envelope({
        message_id: MESSAGE_ID,
        delivered: [],
        permanent_bounces: [message.to],
        queued: [],
      }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      `Cloudflare Email Service permanently bounced: ${message.to}`,
    );
    expect(result.messageId).toBeUndefined();
  });

  test("accepts a message ID when asynchronous recipient buckets are empty", async () => {
    // The live API can accept the message before assigning a recipient outcome.
    const fetchMock = fetchReturning(() =>
      envelope({
        message_id: MESSAGE_ID,
        delivered: [],
        permanent_bounces: [],
        queued: [],
      }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({ success: true, messageId: MESSAGE_ID });
  });

  test("fails when the envelope reports neither an ID nor a recipient outcome", async () => {
    const fetchMock = fetchReturning(() =>
      envelope({ delivered: [], permanent_bounces: [], queued: [] }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/without a message ID or recipient outcome/);
  });

  test("surfaces API envelope errors with their codes", async () => {
    const fetchMock = fetchReturning(() =>
      Response.json(
        {
          success: false,
          errors: [
            {
              code: 10001,
              message: "email.sending.error.invalid_request_schema",
            },
          ],
          messages: [],
          result: null,
        },
        { status: 400 },
      ),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({
      success: false,
      error:
        "Cloudflare Email Service rejected the message: 10001 email.sending.error.invalid_request_schema",
    });
  });

  test("surfaces an errors array returned with HTTP 200", async () => {
    // The documented failure envelope carries a 4xx, but a 200 that says
    // success:false must never be read as a delivery.
    const fetchMock = fetchReturning(() =>
      Response.json({
        success: false,
        errors: [{ code: 10004, message: "email.sending.error.throttled" }],
        messages: [],
        result: null,
      }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(false);
    expect(result.error).toContain("10004 email.sending.error.throttled");
  });

  test("reports an unsuccessful 200 that carries no error details", async () => {
    const fetchMock = fetchReturning(() =>
      Response.json({ success: false, errors: [], messages: [], result: null }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({
      success: false,
      error: "Cloudflare Email Service reported a failed send without an error",
    });
  });

  test("falls back to the HTTP status when a failure carries no usable body", async () => {
    const fetchMock = fetchReturning(
      () => new Response("<html>gateway</html>", { status: 502 }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({
      success: false,
      error: "Failed to send email through Cloudflare Email Service (HTTP 502)",
    });
  });

  test("reports an unauthorized token by its API error", async () => {
    const fetchMock = fetchReturning(() =>
      Response.json(
        {
          success: false,
          errors: [
            {
              code: 10101,
              message: "email.sending.error.authentication.unauthorized",
            },
          ],
          messages: [],
          result: null,
        },
        { status: 401 },
      ),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "10101 email.sending.error.authentication.unauthorized",
    );
  });

  test("fails on a 200 response whose body is not JSON", async () => {
    const fetchMock = fetchReturning(() => new Response("not json"));

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({
      success: false,
      error: "Cloudflare Email Service returned a malformed response",
    });
  });

  test("fails on a successful envelope with an unusable result", async () => {
    const fetchMock = fetchReturning(() =>
      Response.json({ success: true, errors: [], messages: [], result: null }),
    );

    const result = await driverWith(fetchMock).send(message);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/without a message ID or recipient outcome/);
  });

  test("refuses to send without credentials", async () => {
    const fetchMock = fetchReturning(() => delivered(message.to));

    for (const overrides of [
      { accountId: "" },
      { apiToken: "" },
      { apiToken: "   " },
    ]) {
      const result = await driverWith(fetchMock, overrides).send(message);

      expect(result).toEqual({
        success: false,
        error:
          "Cloudflare mail driver requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reports a network failure instead of throwing", async () => {
    const fetchMock = fetchReturning(() => {
      throw new Error("getaddrinfo ENOTFOUND api.cloudflare.com");
    });

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({
      success: false,
      error: "getaddrinfo ENOTFOUND api.cloudflare.com",
    });
  });

  test("reports a non-Error transport rejection", async () => {
    const fetchMock = mock(async () => {
      throw "socket hang up";
    });

    const result = await driverWith(fetchMock).send(message);

    expect(result).toEqual({ success: false, error: "Unknown email error" });
  });
});
