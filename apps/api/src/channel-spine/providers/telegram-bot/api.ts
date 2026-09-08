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

export async function downloadTelegramFile(
  token: string,
  fileId: string,
  maxBytes = 20 * 1024 * 1024,
): Promise<{ data: Uint8Array; contentType: string }> {
  if (!fileId || fileId.length > 512)
    throw new Error("invalid Telegram file ID");
  const file = await telegramBotRequest<{
    file_path?: string;
    file_size?: number;
  }>(token, "getFile", { file_id: fileId });
  if (
    !file.file_path ||
    file.file_path.startsWith("/") ||
    file.file_path.split("/").includes("..") ||
    !/^[A-Za-z0-9_./-]+$/.test(file.file_path)
  ) {
    throw new Error("Telegram returned an invalid file path");
  }
  if (file.file_size !== undefined && file.file_size > maxBytes) {
    throw new Error("Telegram file exceeds the download limit");
  }
  const safePath = file.file_path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  let response: Response;
  try {
    response = await fetch(
      `${TELEGRAM_API_ORIGIN}/file/bot${token}/${safePath}`,
      {
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        redirect: "error",
      },
    );
  } catch {
    throw new Error("Telegram file service is unavailable");
  }
  if (!response.ok) throw new Error("Telegram file download was rejected");
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Telegram file exceeds the download limit");
  }
  const data = await readLimitedBody(response, maxBytes);
  return {
    data,
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
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

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Telegram file exceeds the download limit");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function isTelegramResponse(
  value: unknown,
): value is { ok: boolean; result: unknown } {
  return Boolean(value && typeof value === "object" && "ok" in value);
}
