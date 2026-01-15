/**
 * NATS Types Index
 * Re-exports all NATS type definitions
 */

// Base types
export {
  NATS_SUBJECTS,
  type MessageType,
  type StatusType,
  type NatsCommand,
  type WhatsAppEvent,
} from "./base.js";

// Command types
export type {
  SpawnCommand,
  KillCommand,
  SendMessageCommand,
  PostStatusCommand,
  GroupPromoteAdminCommand,
  GroupDemoteAdminCommand,
  GroupRemoveParticipantCommand,
  GroupUpdateSettingsCommand,
  SyncLabelsCommand,
  ApplyLabelCommand,
  RemoveLabelCommand,
  SyncCatalogsCommand,
  SyncCatalogProductsCommand,
  BlockContactCommand,
  UnblockContactCommand,
} from "./commands.js";

// Event types
export type {
  MessageRevokeEvent,
  ProfilePictureEvent,
  LabelsEvent,
  CatalogsEvent,
  CatalogProductsEvent,
  QREvent,
  ConnectionEvent,
  MessageEvent,
  ReceiptEvent,
  SendConfirmationEvent,
  StatusEvent,
  ContactEvent,
  PresenceEvent,
  TypingEvent,
  ReactionEvent,
  DownloadResponseEvent,
  SyncStatusEvent,
  SendFailedEvent,
  WorkerConnectionStatusEvent,
} from "./events.js";
