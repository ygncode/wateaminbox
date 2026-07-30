import * as jose from "jose";
import { env } from "./env.js";
import { createLogger, formatError } from "./logger.js";

const logger = createLogger("Realtime");

export type CompanyRealtimeEventType =
  | "message:new"
  | "message:status"
  | "message:deleted"
  | "message:reaction"
  | "message:failed"
  | "scheduled_message:updated"
  | "qr"
  | "connected"
  | "disconnected"
  | "connection:status"
  | "typing:start"
  | "typing:stop"
  | "sync:start"
  | "sync:progress"
  | "sync:complete"
  | "sync:interrupted"
  | "history:loaded"
  | "media:downloaded"
  | "media:download_failed"
  | "notification:toast"
  | "status"
  | "contact:updated"
  | "contact:profile_picture"
  | "presence:online"
  | "presence:offline"
  | "conversation:read"
  | "conversation:updated"
  | "labels:updated"
  | "catalogs:updated"
  | "command:failed";

export type UserRealtimeEventType = "notification:new";
export type RealtimeEventType =
  | CompanyRealtimeEventType
  | UserRealtimeEventType;

interface CentrifugoError {
  code: number;
  message: string;
}

interface CentrifugoResponse {
  error?: CentrifugoError;
  result?: unknown;
}

export interface RealtimeEventData {
  payload: unknown;
  connectionId?: string;
  excludeClientId?: string;
  timestamp: string;
}

export const REALTIME_TOKEN_AUDIENCE = "wateaminbox-realtime";
export const REALTIME_TOKEN_ISSUER = "wateaminbox-api";

export function getCompanyChannelName(companyId: string): string {
  return `company:${companyId}`;
}

export function getUserChannelName(companyId: string, userId: string): string {
  return `user:${companyId}:${userId}`;
}

export function getRealtimeChannels(
  companyId: string,
  userId: string,
): string[] {
  return [
    getCompanyChannelName(companyId),
    getUserChannelName(companyId, userId),
  ];
}

function requireRealtimeConfig(): void {
  const missing = [
    ["CENTRIFUGO_API_URL", env.CENTRIFUGO_API_URL],
    ["CENTRIFUGO_API_KEY", env.CENTRIFUGO_API_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Centrifugo is not configured: ${missing.join(", ")}`);
  }
}

async function publishToChannel(
  channel: string,
  eventType: RealtimeEventType,
  data: RealtimeEventData,
): Promise<void> {
  requireRealtimeConfig();

  const response = await fetch(
    `${env.CENTRIFUGO_API_URL.replace(/\/$/, "")}/publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.CENTRIFUGO_API_KEY,
      },
      body: JSON.stringify({
        channel,
        data: { type: eventType, data },
      }),
      signal: AbortSignal.timeout(env.CENTRIFUGO_REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`Centrifugo publish failed with HTTP ${response.status}`);
  }

  const result = (await response.json()) as CentrifugoResponse;
  if (result.error) {
    throw new Error(
      `Centrifugo publish failed (${result.error.code}): ${result.error.message}`,
    );
  }
}

export async function broadcastToCompany(
  companyId: string,
  eventType: CompanyRealtimeEventType,
  payload: unknown,
  connectionId?: string,
): Promise<void> {
  try {
    await publishToChannel(getCompanyChannelName(companyId), eventType, {
      payload,
      connectionId,
      timestamp: new Date().toISOString(),
    });

    if (eventType === "message:new" || eventType === "qr") {
      logger.debug({ companyId, eventType, connectionId }, "Published event");
    }
    if (
      eventType === "media:downloaded" ||
      eventType === "media:download_failed"
    ) {
      logger.info({ companyId, eventType }, "Published media event");
    }
  } catch (error) {
    logger.error(
      { error: formatError(error), companyId, eventType },
      "Failed to publish realtime event",
    );
    // Realtime is an update signal; persisted operations remain authoritative.
  }
}

export async function broadcastToCompanyExcept(
  companyId: string,
  eventType: CompanyRealtimeEventType,
  payload: unknown,
  excludeClientId?: string,
): Promise<void> {
  try {
    await publishToChannel(getCompanyChannelName(companyId), eventType, {
      payload,
      excludeClientId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      { error: formatError(error), companyId, eventType },
      "Failed to publish realtime event",
    );
  }
}

/** Publish a non-sensitive signal to exactly one authenticated user channel. */
export async function broadcastToUser(
  companyId: string,
  userId: string,
  eventType: UserRealtimeEventType,
  payload: unknown,
): Promise<void> {
  await publishToChannel(getUserChannelName(companyId, userId), eventType, {
    payload,
    timestamp: new Date().toISOString(),
  });
}

export async function createRealtimeConnectionToken(
  userId: string,
  companyId: string,
  secret = env.CENTRIFUGO_TOKEN_HMAC_SECRET,
): Promise<string> {
  if (!secret) {
    throw new Error(
      "Centrifugo token signing is not configured: CENTRIFUGO_TOKEN_HMAC_SECRET is required",
    );
  }

  return new jose.SignJWT({
    channels: getRealtimeChannels(companyId, userId),
    companyId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience(REALTIME_TOKEN_AUDIENCE)
    .setIssuer(REALTIME_TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(secret));
}

export async function isCentrifugoReachable(): Promise<boolean> {
  if (!env.CENTRIFUGO_HEALTH_URL) return false;
  try {
    const response = await fetch(env.CENTRIFUGO_HEALTH_URL, {
      signal: AbortSignal.timeout(env.CENTRIFUGO_REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
