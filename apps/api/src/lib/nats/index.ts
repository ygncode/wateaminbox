// Re-export all types

// Re-export all client operations
export {
  buildCommandSubject,
  buildSendMessageCommand,
  buildSendReactionCommand,
  closeNatsConnection,
  getJetStreamClient,
  getNatsConnection,
  isNatsConnected,
  PermanentEventError,
  publishApplyLabel,
  publishCommand,
  publishKillCommand,
  publishOutboxCommand,
  publishPostStatus,
  publishRemoveLabel,
  publishSendMessage,
  publishSendReaction,
  publishSpawnCommand,
  publishSyncCatalogProducts,
  publishSyncCatalogs,
  publishSyncLabels,
  publishTypingCommand,
  request,
  subscribe,
  subscribeToAllEvents,
  subscribeToCompanyEvents,
  subscribeToConnectionEvents,
} from "./client.js";
export type { NatsReadinessState } from "./lifecycle.js";

export { natsLifecycle } from "./lifecycle.js";
export * from "./types/index.js";
