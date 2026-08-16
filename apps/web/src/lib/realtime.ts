import {
  Centrifuge,
  type ErrorContext,
  type ServerPublicationContext,
  State,
  type StateContext,
  UnauthorizedError,
} from "centrifuge";
import { ApiRequestError, fetchWithAuth, getCompanyId } from "./api/client";

const CENTRIFUGO_URL =
  import.meta.env.VITE_CENTRIFUGO_URL ||
  (import.meta.env.DEV ? "ws://localhost:4451/connection/websocket" : "");

let realtimeInstance: Centrifuge | null = null;
let currentCompanyId: string | null = null;
let currentUserId: string | null = null;
let realtimeClientId: string | undefined;

/** Workspace-wide control events, delivered on the shared company channel. */
export type CompanyRealtimeEventType =
  | "bulk_job:updated"
  | "qr"
  | "connected"
  | "disconnected"
  | "connection:status"
  | "sync:start"
  | "sync:progress"
  | "sync:complete"
  | "sync:interrupted"
  | "notification:toast"
  | "status"
  | "labels:updated"
  | "catalogs:updated"
  | "command:failed";

/**
 * Events scoped to one contact's conversation. The server fans these out to
 * the users authorized to read that conversation, so they arrive on this
 * user's own channel rather than the shared company channel.
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
  | "conversation:updated"
  | "group:updated";

/** Events the server addresses to this user's own channel. */
export type UserRealtimeEventType =
  | "notification:new"
  | ConversationRealtimeEventType;
export type RealtimeEventType =
  | CompanyRealtimeEventType
  | UserRealtimeEventType;

export interface RealtimeEventData<T = unknown> {
  payload: T;
  connectionId?: string;
  excludeClientId?: string;
  timestamp: string;
}

interface RealtimePublication {
  type: RealtimeEventType;
  data: RealtimeEventData;
}

export type RealtimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected";

export type RealtimeEventHandler<T = unknown> = (
  data: RealtimeEventData<T>,
) => void;

type UntypedHandler = RealtimeEventHandler<unknown>;
const companyHandlers = new Map<
  CompanyRealtimeEventType,
  Set<UntypedHandler>
>();
const userHandlers = new Map<UserRealtimeEventType, Set<UntypedHandler>>();

function getCompanyChannelName(companyId: string): string {
  return `company:${companyId}`;
}

function getUserChannelName(companyId: string, userId: string): string {
  return `user:${companyId}:${userId}`;
}

async function getConnectionToken(): Promise<string> {
  try {
    const response = await fetchWithAuth<{ token: string }>("/realtime/token", {
      method: "POST",
    });
    return response.token;
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      throw new UnauthorizedError(error.message);
    }
    throw error;
  }
}

function isRealtimePublication(value: unknown): value is RealtimePublication {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RealtimePublication>;
  return typeof candidate.type === "string" && Boolean(candidate.data);
}

function dispatchPublication(context: ServerPublicationContext): void {
  if (!isRealtimePublication(context.data)) return;

  const publication = context.data;
  if (
    publication.data.excludeClientId &&
    publication.data.excludeClientId === realtimeClientId
  ) {
    return;
  }

  let handlers: Set<UntypedHandler> | undefined;
  if (
    currentCompanyId &&
    context.channel === getCompanyChannelName(currentCompanyId)
  ) {
    handlers = companyHandlers.get(
      publication.type as CompanyRealtimeEventType,
    );
  } else if (
    currentCompanyId &&
    currentUserId &&
    context.channel === getUserChannelName(currentCompanyId, currentUserId)
  ) {
    handlers = userHandlers.get(publication.type as UserRealtimeEventType);
  }

  handlers?.forEach((handler) => handler(publication.data));
}

/** Create the singleton client. Call connectRealtime after handlers are bound. */
export function initializeRealtime(): Centrifuge {
  if (realtimeInstance) return realtimeInstance;
  if (!CENTRIFUGO_URL) {
    throw new Error(
      "VITE_CENTRIFUGO_URL is required for realtime communication",
    );
  }

  realtimeInstance = new Centrifuge(CENTRIFUGO_URL, {
    getToken: getConnectionToken,
  });
  realtimeInstance.on("publication", dispatchPublication);
  realtimeInstance.on("connected", (context) => {
    realtimeClientId = context.client;
  });
  realtimeInstance.on("disconnected", () => {
    realtimeClientId = undefined;
  });

  if (import.meta.env.DEV) {
    realtimeInstance.on("state", (context: StateContext) => {
      console.log(
        "[Centrifugo] Connection state changed:",
        context.oldState,
        "->",
        context.newState,
      );
    });
    realtimeInstance.on("error", (context: ErrorContext) => {
      console.error("[Centrifugo] Connection error:", context.error);
    });
  }

  return realtimeInstance;
}

export function connectRealtime(): void {
  initializeRealtime().connect();
}

export function getRealtime(): Centrifuge | null {
  return realtimeInstance;
}

/** Client identifier included with REST actions to suppress self-notifications. */
export function getRealtimeClientId(): string | undefined {
  return realtimeClientId;
}

/** Record the server-side company subscription included in the connection JWT. */
export function subscribeToCompany(companyId: string): void {
  currentCompanyId = companyId;
}

/** Record the server-side user subscription included in the connection JWT. */
export function subscribeToUser(companyId: string, userId: string): void {
  currentCompanyId = companyId;
  currentUserId = userId;
}

export function unsubscribeFromUser(): void {
  currentUserId = null;
}

export function unsubscribeFromCompany(): void {
  currentCompanyId = null;
  currentUserId = null;
}

function bindHandler<T extends RealtimeEventType>(
  handlers: Map<T, Set<UntypedHandler>>,
  eventType: T,
  handler: RealtimeEventHandler,
): () => void {
  const eventHandlers = handlers.get(eventType) ?? new Set<UntypedHandler>();
  eventHandlers.add(handler);
  handlers.set(eventType, eventHandlers);
  return () => {
    eventHandlers.delete(handler);
    if (eventHandlers.size === 0) handlers.delete(eventType);
  };
}

export function bindEvent<T = unknown>(
  eventType: CompanyRealtimeEventType,
  handler: RealtimeEventHandler<T>,
): () => void {
  return bindHandler(
    companyHandlers,
    eventType,
    handler as RealtimeEventHandler,
  );
}

export function bindUserEvent<T = unknown>(
  eventType: UserRealtimeEventType,
  handler: RealtimeEventHandler<T>,
): () => void {
  return bindHandler(userHandlers, eventType, handler as RealtimeEventHandler);
}

export function getConnectionState(): RealtimeConnectionStatus {
  return (realtimeInstance?.state ??
    State.Disconnected) as RealtimeConnectionStatus;
}

export function onConnectionStateChange(
  handler: (state: RealtimeConnectionStatus) => void,
): () => void {
  const instance = initializeRealtime();
  const wrappedHandler = (context: StateContext) => {
    handler(context.newState as RealtimeConnectionStatus);
  };
  instance.on("state", wrappedHandler);
  return () => instance.off("state", wrappedHandler);
}

export function disconnectRealtime(): void {
  if (realtimeInstance) {
    realtimeInstance.disconnect();
    realtimeInstance.removeAllListeners();
    realtimeInstance = null;
  }
  realtimeClientId = undefined;
  unsubscribeFromCompany();
}

export function reconnectRealtime(): void {
  const companyId = currentCompanyId ?? getCompanyId();
  const userId = currentUserId;
  disconnectRealtime();
  if (companyId) subscribeToCompany(companyId);
  if (companyId && userId) subscribeToUser(companyId, userId);
  connectRealtime();
}

/** Reconnect so the next token reflects refreshed authentication and tenancy. */
export function updateAuthCredentials(): void {
  if (!realtimeInstance) return;
  reconnectRealtime();
}
