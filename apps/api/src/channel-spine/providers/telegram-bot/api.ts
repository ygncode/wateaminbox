const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 10_000;

export interface TelegramBotIdentity {
  id: number;
  username?: string;
  first_name: string;
}

export async function getTelegramBotIdentity(
  token: string,
): Promise<TelegramBotIdentity> {
  return telegramBotRequest<TelegramBotIdentity>(token, "getMe", {});
}

export async function configureTelegramWebhook(
  token: string,
  webhookUrl: string,
  secretToken: string,
): Promise<void> {
  await telegramBotRequest(token, "setWebhook", {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: [
      "message",
      "edited_message",
      "channel_post",
      "edited_channel_post",
      "message_reaction",
    ],
    drop_pending_updates: false,
  });
}

export async function removeTelegramWebhook(token: string): Promise<void> {
  await telegramBotRequest(token, "deleteWebhook", {
    drop_pending_updates: false,
  });
}

export async function telegramBotRequest<T = true>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  if (!/^\d{5,16}:[A-Za-z0-9_-]{30,128}$/.test(token)) {
    throw new Error("invalid Telegram bot credential");
  }
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API_ORIGIN}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Telegram Bot API is unavailable");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Telegram Bot API returned an invalid response");
  }
  if (!response.ok || !isTelegramResponse(result) || !result.ok) {
    throw new Error("Telegram Bot API rejected the request");
  }
  return result.result as T;
}

function isTelegramResponse(
  value: unknown,
): value is { ok: boolean; result: unknown } {
  return Boolean(value && typeof value === "object" && "ok" in value);
}
