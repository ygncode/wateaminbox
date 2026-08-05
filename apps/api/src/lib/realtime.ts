import * as jose from "jose";
import { env } from "./env.js";
import { createLogger, formatError } from "./logger.js";

const logger = createLogger("Realtime");

/**
 * Workspace-wide control events.
 *
 * Every member is subscribed to `company:{companyId}`, so anything listed here
 * is readable by the whole workspace by design. Only events that describe the
 * workspace or a WhatsApp connection belong here - never one contact's
 * conversation, activity, or identity. Those are `ConversationRealtimeEventType`.
 */
export type CompanyRealtimeEventType =
  | "bulk_job:updated"
  // `status` (WhatsApp Status/Stories) is a deliberate policy decision, not an
  // oversight: a Status is broadcast by its author to their whole audience
  // rather than sent into a conversation, and `status_updates` rows carry a
  // JID and connection but no contact/assignee to scope visibility on. See
  // "Policy: status stays workspace-wide" in docs/realtime-flow.md.
  | "status"
  | "qr"
  | "connected"
  | "disconnected"
  | "connection:status"
  | "sync:start"
  | "sync:progress"
  | "sync:complete"
  | "sync:interrupted"
  | "history:loaded"
  | "notification:toast"
  | "labels:updated"
  | "catalogs:updated"
  | "command:failed";

/**
 * Events scoped to a single contact's conversation.
 *
 * Each of these names a conversation, a message inside one, or a contact's
 * identity/activity, so publishing them company-wide tells a member which
 * conversations exist and when they are active - exactly what
 * `requireContactVisibility` withholds over HTTP. They are delivered to the
 * authorized viewers of that contact instead; see
 * `services/message-broadcast.service.ts`.
 */
export type ConversationRealtimeEventType =
  | "message:new"
  | "message:status"
  | "message:deleted"
  | "message:reaction"
  | "message:failed"
  | "scheduled_message:updated"
  | "typing:start"
  | "typing:stop"
  | "media:downloaded"
  | "media:download_failed"
  | "contact:updated"
  | "contact:profile_picture"
  | "presence:online"
  | "presence:offline"
  | "conversation:read"
  | "conversation:updated";

/** Events addressed to one authenticated user's own channel. */
export type UserRealtimeEventType =
  | "notification:new"
  | ConversationRealtimeEventType;

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

interface CentrifugoBroadcastResponse {
  error?: CentrifugoError;
  result?: { responses?: Array<{ error?: CentrifugoError }> };
}

/**
 * Publish one payload to many channels in a single Centrifugo API call.
 *
 * Visibility-scoped fan-out addresses one channel per authorized user, so a
 * per-channel loop would turn every conversation event into N HTTP round
 * trips. Centrifugo's `broadcast` keeps that at exactly one regardless of
 * audience size, which is what makes fan-out affordable for high-frequency
 * events like typing and presence.
 */
async function publishToChannels(
  channels: readonly string[],
  eventType: RealtimeEventType,
  data: RealtimeEventData,
): Promise<void> {
  if (channels.length === 0) return;
  requireRealtimeConfig();

  const response = await fetch(
    `${env.CENTRIFUGO_API_URL.replace(/\/$/, "")}/broadcast`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.CENTRIFUGO_API_KEY,
      },
      body: JSON.stringify({
        channels,
        data: { type: eventType, data },
      }),
      signal: AbortSignal.timeout(env.CENTRIFUGO_REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`Centrifugo broadcast failed with HTTP ${response.status}`);
  }

  const result = (await response.json()) as CentrifugoBroadcastResponse;
  if (result.error) {
    throw new Error(
      `Centrifugo broadcast failed (${result.error.code}): ${result.error.message}`,
    );
  }
  // Per-channel errors are reported inside the batch rather than as a
  // top-level failure, so they must be inspected explicitly.
  const failure = result.result?.responses?.find((entry) => entry.error)?.error;
  if (failure) {
    throw new Error(
      `Centrifugo broadcast failed for a channel (${failure.code}): ${failure.message}`,
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

    if (eventType === "qr") {
      logger.debug({ companyId, eventType, connectionId }, "Published event");
    }
  } catch (error) {
    logger.error(
      { error: formatError(error), companyId, eventType },
      "Failed to publish realtime event",
    );
    // Realtime is an update signal; persisted operations remain authoritative.
  }
}

// `broadcastToCompanyExcept` was removed with the conversation-event migration.
// Its only callers were the typing and read-receipt routes, which are now
// visibility-scoped; keeping a company-wide "except one client" helper around
// would just be a loaded gun for the next conversation event. Use
// `broadcastToUsers` with `excludeClientId` instead.

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

export interface UserFanOutOptions {
  /** WhatsApp connection the event originated from, echoed to clients. */
  connectionId?: string;
  /** Centrifugo client ID that triggered the event and should not see it. */
  excludeClientId?: string;
}

/**
 * Fan a payload out to an explicit, already-authorized set of user channels.
 *
 * Delivery is one Centrifugo batch regardless of audience size, and never
 * throws: realtime is an update signal, and the persisted rows stay
 * authoritative. A publish failure must not fail the operation that produced
 * the event.
 */
export async function broadcastToUsers(
  companyId: string,
  userIds: readonly string[],
  eventType: UserRealtimeEventType,
  payload: unknown,
  options: UserFanOutOptions = {},
): Promise<void> {
  // Deduplicated here rather than trusting callers: a repeated channel in the
  // batch delivers the event to that user twice, which clients would apply
  // twice. Callers do currently pass a set, but this is the single choke point
  // every fan-out goes through, so the guarantee belongs here.
  const channels = [
    ...new Set(
      userIds
        .filter((userId) => Boolean(userId))
        .map((userId) => getUserChannelName(companyId, userId)),
    ),
  ];

  // Centrifugo rejects an empty `channels` array with a top-level "bad
  // request" (code 107), so an empty audience must not reach the transport.
  if (channels.length === 0) return;

  try {
    await publishToChannels(channels, eventType, {
      payload,
      connectionId: options.connectionId,
      excludeClientId: options.excludeClientId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      {
        error: formatError(error),
        companyId,
        eventType,
        recipients: channels.length,
      },
      "Failed to publish realtime event to user channels",
    );
  }
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
