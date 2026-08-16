/**
 * NATS Types Index
 * Re-exports all NATS type definitions
 */

// Base types
export {
  type MessageType,
  NATS_SUBJECTS,
  type NatsCommand,
  type StatusType,
  type WhatsAppEvent,
} from "./base.js";

// Command types
export type {
  ApplyLabelCommand,
  BlockContactCommand,
  GroupAddParticipantsCommand,
  GroupCreateCommand,
  GroupDemoteAdminCommand,
  GroupInviteLinkCommand,
  GroupJoinRequestsFetchCommand,
  GroupJoinRequestsUpdateCommand,
  GroupLeaveCommand,
  GroupPromoteAdminCommand,
  GroupRemoveParticipantsCommand,
  GroupSyncCommand,
  GroupUpdateSettingsCommand,
  KillCommand,
  PostStatusCommand,
  RemoveLabelCommand,
  RequestHistoryCommand,
  SendMessageCommand,
  SpawnCommand,
  SyncCatalogProductsCommand,
  SyncCatalogsCommand,
  SyncLabelsCommand,
  UnblockContactCommand,
} from "./commands.js";

// Event types
export type {
  CatalogProductsEvent,
  CatalogsEvent,
  CommandOutcome,
  CommandResultEvent,
  ConnectionEvent,
  ContactEvent,
  DownloadResponseEvent,
  GroupEvent,
  GroupSnapshotPayload,
  HistorySyncPageEvent,
  LabelsEvent,
  MessageEvent,
  MessageRevokeEvent,
  PresenceEvent,
  ProfilePictureEvent,
  QREvent,
  ReactionEvent,
  ReceiptEvent,
  SendConfirmationEvent,
  SendFailedEvent,
  StatusEvent,
  SyncStatusEvent,
  TypingEvent,
  WorkerConnectionStatusEvent,
} from "./events.js";
