export const CHANNELS = [
  "whatsapp",
  "messenger",
  "instagram",
  "telegram",
  "line",
  "viber",
  "email",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const PROVIDERS = [
  "whatsapp_linked_device",
  "meta_cloud",
  "telegram_bot",
  "line_messaging",
  "viber_bot",
  "gmail",
  "microsoft_graph",
  "imap_smtp",
] as const;
export type ChannelProvider = (typeof PROVIDERS)[number];

export const DURABLE_CHANNEL_EVENT_KINDS = [
  "account.status",
  "endpoint.upsert",
  "conversation.upsert",
  "participant.upsert",
  "participant.remove",
  "message.upsert",
  "message.edit",
  "message.delete",
  "reaction.upsert",
  "reaction.delete",
  "delivery.update",
  "attachment.available",
  "attachment.failed",
  "sync.checkpoint",
] as const;

export const TRANSIENT_CHANNEL_EVENT_KINDS = [
  "typing.update",
  "presence.update",
] as const;

export type DurableChannelEventKind =
  (typeof DURABLE_CHANNEL_EVENT_KINDS)[number];
export type TransientChannelEventKind =
  (typeof TRANSIENT_CHANNEL_EVENT_KINDS)[number];
export type ChannelEventKind =
  | DurableChannelEventKind
  | TransientChannelEventKind;

export interface ExternalEndpointReference {
  externalId: string;
  identityScope: string;
  endpointKind: string;
  normalizedAddress?: string;
  addressDisplay?: string;
  displayName?: string;
}

export interface ExternalConversationReference {
  externalThreadId?: string;
  clientThreadKey: string;
  kind: "direct" | "group" | "thread";
  subject?: string;
}

export interface NormalizedAttachment {
  ordinal: number;
  kind: string;
  providerAttachmentId?: string;
  fileName?: string;
  contentType?: string;
  byteSize?: number;
  storageUri?: string;
  status: "pending" | "available" | "failed" | "deleted";
  errorCode?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface AccountStatusEventPayload {
  status:
    | "connecting"
    | "connected"
    | "degraded"
    | "disconnected"
    | "disabled"
    | "error"
    | "archived";
  providerStatus?: string;
}

export interface EndpointUpsertEventPayload {
  endpoint: ExternalEndpointReference;
  verificationState:
    | "unverified"
    | "provider_verified"
    | "user_verified"
    | "invalid";
  providerMetadata?: Record<string, unknown>;
}

export interface ConversationUpsertEventPayload {
  conversation: ExternalConversationReference;
  providerStatus?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ParticipantUpsertEventPayload {
  conversation: ExternalConversationReference;
  endpoint?: ExternalEndpointReference;
  participantKind: "external" | "workspace_user" | "account";
  role: string;
  isSelf: boolean;
  workspaceUserId?: string;
  joinedAt?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ParticipantRemoveEventPayload {
  conversation: ExternalConversationReference;
  endpoint?: ExternalEndpointReference;
  workspaceUserId?: string;
  leftAt?: string;
}

export interface MessageUpsertEventPayload {
  conversation: ExternalConversationReference;
  externalMessageId: string;
  externalIdentityScope: string;
  direction: "inbound" | "outbound" | "system";
  sender?: ExternalEndpointReference;
  normalizedType: string;
  subject?: string;
  textContent?: string;
  sanitizedHtmlContent?: string;
  replyToExternalMessageId?: string;
  sentByUserId?: string;
  attachments?: NormalizedAttachment[];
  providerMetadata?: Record<string, unknown>;
}

export interface MessageMutationEventPayload {
  conversation: ExternalConversationReference;
  externalMessageId: string;
  externalIdentityScope: string;
  textContent?: string;
  sanitizedHtmlContent?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ReactionEventPayload {
  conversation: ExternalConversationReference;
  messageExternalId: string;
  messageIdentityScope: string;
  externalReactionId?: string;
  externalEventScope?: string;
  reactor: ExternalEndpointReference;
  emoji: string;
}

export interface DeliveryUpdateEventPayload {
  messageExternalId: string;
  messageIdentityScope: string;
  recipient?: ExternalEndpointReference;
  externalEventId?: string;
  externalEventScope?: string;
  status: string;
  errorCode?: string;
  errorDetail?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface AttachmentEventPayload {
  messageExternalId: string;
  messageIdentityScope: string;
  attachment: NormalizedAttachment;
}

export interface TypingEventPayload {
  conversation: ExternalConversationReference;
  participant?: ExternalEndpointReference;
  isTyping: boolean;
  expiresAt?: string;
}

export interface PresenceEventPayload {
  endpoint: ExternalEndpointReference;
  availability: "unknown" | "offline" | "online" | "away" | "unavailable";
  lastSeenAt?: string;
  expiresAt?: string;
}

export interface SyncCheckpointEventPayload {
  conversation?: ExternalConversationReference;
  status: string;
  cursorOrAnchor?: string;
  requestGeneration?: number;
  errorCode?: string;
}

interface ChannelEventPayloads {
  "account.status": AccountStatusEventPayload;
  "endpoint.upsert": EndpointUpsertEventPayload;
  "conversation.upsert": ConversationUpsertEventPayload;
  "participant.upsert": ParticipantUpsertEventPayload;
  "participant.remove": ParticipantRemoveEventPayload;
  "message.upsert": MessageUpsertEventPayload;
  "message.edit": MessageMutationEventPayload;
  "message.delete": MessageMutationEventPayload;
  "reaction.upsert": ReactionEventPayload;
  "reaction.delete": ReactionEventPayload;
  "delivery.update": DeliveryUpdateEventPayload;
  "attachment.available": AttachmentEventPayload;
  "attachment.failed": AttachmentEventPayload;
  "typing.update": TypingEventPayload;
  "presence.update": PresenceEventPayload;
  "sync.checkpoint": SyncCheckpointEventPayload;
}

export type NormalizedChannelEvent = {
  [Kind in ChannelEventKind]: {
    contractVersion: 1;
    eventId: string;
    companyId: string;
    channelAccountId: string;
    channel: Channel;
    provider: ChannelProvider;
    kind: Kind;
    providerOccurredAt?: string;
    receivedAt: string;
    payload: ChannelEventPayloads[Kind];
  };
}[ChannelEventKind];

export interface ProviderIngress {
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
  receivedAt: string;
  trustedContext: {
    companyId: string;
    channelAccountId: string;
  };
}

export interface CapabilityContext {
  companyId: string;
  channelAccountId: string;
  conversationId?: string;
  messageId?: string;
  now: string;
}

export interface ComposerTypeDescriptor {
  type: string;
  enabled: boolean;
  maxTextLength?: number;
  caption?: { enabled: boolean; maxLength?: number };
  attachment?: {
    maxBytes?: number;
    maxCount?: number;
    acceptedContentTypes?: string[];
    albums?: boolean;
  };
  templateRequired?: boolean;
  unavailableReasonCode?: string;
}

export interface ChannelCapabilities {
  typing: boolean;
  readReceipts: boolean;
  reactions: boolean;
  messageEditing: boolean;
  messageDeletion: boolean;
  templates: boolean;
  groups: boolean;
  multipleRecipients: boolean;
  outboundInitiation: boolean;
  scheduledMessages: boolean;
}

export interface ResolvedCapabilities extends ChannelCapabilities {
  messageTypes: ComposerTypeDescriptor[];
  actions: {
    reply: boolean;
    quote: boolean;
    forward: boolean;
    retry: boolean;
    starLocally: boolean;
    deleteLocally: boolean;
    deleteForEveryone: boolean;
    groupMentions: boolean;
    remoteHistory: boolean;
  };
  attachment: {
    enabled: boolean;
    maxBytes?: number;
    maxCount?: number;
    acceptedContentTypes?: string[];
  };
  constraints: Record<string, unknown>;
  unavailableReasons: Partial<
    Record<keyof ChannelCapabilities, { code: string; message: string }>
  >;
  version: string;
}

export interface OutboundMessageIntent {
  id: string;
  companyId: string;
  channelAccountId: string;
  conversationId: string;
  messageId?: string;
  operation: string;
  idempotencyKey: string;
  requestFingerprint: string;
  normalizedPayload: Readonly<Record<string, unknown>>;
  attemptKey: string;
}

export type ProviderSendResult =
  | {
      outcome: "accepted" | "confirmed";
      providerRequestId?: string;
      externalMessageId?: string;
      externalIdentityScope?: string;
    }
  | {
      outcome: "transient_failure" | "permanent_failure" | "uncertain";
      errorCode: string;
      retryAfterMs?: number;
      providerRequestId?: string;
    };

export interface ChannelActionIntent {
  companyId: string;
  channelAccountId: string;
  conversationId: string;
  operation: string;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
}

export type ProviderActionResult =
  | { outcome: "confirmed" | "accepted"; providerRequestId?: string }
  | {
      outcome:
        | "unsupported"
        | "transient_failure"
        | "permanent_failure"
        | "uncertain";
      errorCode: string;
      retryAfterMs?: number;
    };

export interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: ChannelProvider;
  verifyAndNormalizeIngress(
    input: ProviderIngress,
  ): Promise<NormalizedChannelEvent[]>;
  resolveCapabilities(
    context: CapabilityContext,
  ): Promise<ResolvedCapabilities>;
  send(intent: OutboundMessageIntent): Promise<ProviderSendResult>;
  perform(action: ChannelActionIntent): Promise<ProviderActionResult>;
}

export function assertNormalizedChannelEvent(
  event: NormalizedChannelEvent,
): void {
  if (event.contractVersion !== 1) {
    throw new Error("unsupported channel event contract version");
  }
  if (!nonBlank(event.eventId)) throw new Error("channel event ID is required");
  if (!nonBlank(event.companyId)) throw new Error("company ID is required");
  if (!nonBlank(event.channelAccountId)) {
    throw new Error("channel account ID is required");
  }
  if (!isChannel(event.channel)) throw new Error("unsupported channel");
  if (!isChannelProvider(event.provider))
    throw new Error("unsupported provider");
  if (!Number.isFinite(Date.parse(event.receivedAt))) {
    throw new Error("receivedAt must be an ISO timestamp");
  }
  if (
    event.providerOccurredAt !== undefined &&
    !Number.isFinite(Date.parse(event.providerOccurredAt))
  ) {
    throw new Error("providerOccurredAt must be an ISO timestamp");
  }
}

export function isDurableChannelEvent(
  event: NormalizedChannelEvent,
): event is Extract<NormalizedChannelEvent, { kind: DurableChannelEventKind }> {
  return (DURABLE_CHANNEL_EVENT_KINDS as readonly string[]).includes(
    event.kind,
  );
}

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

export function isChannelProvider(value: string): value is ChannelProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}
