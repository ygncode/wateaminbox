// Re-export all types
export * from "./types/index.js";

// Re-export all client operations
export {
  getNatsConnection,
  getJetStreamClient,
  publishCommand,
  publishOutboxCommand,
  buildCommandSubject,
  publishSpawnCommand,
  publishKillCommand,
  buildSendMessageCommand,
  publishSendMessage,
  publishPostStatus,
  publishSyncLabels,
  publishApplyLabel,
  publishRemoveLabel,
  subscribe,
  subscribeToCompanyEvents,
  subscribeToConnectionEvents,
  subscribeToAllEvents,
  closeNatsConnection,
  isNatsConnected,
  request,
  publishSyncCatalogs,
  publishSyncCatalogProducts,
  buildSendReactionCommand,
  publishSendReaction,
  publishTypingCommand,
  PermanentEventError,
} from "./client.js";

export { natsLifecycle } from "./lifecycle.js";
export type { NatsReadinessState } from "./lifecycle.js";
