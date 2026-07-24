/**
 * NATS Module Index
 * Re-exports all NATS types and client operations for backward compatibility
 *
 * Usage: import { ... } from "@/lib/nats"
 */

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
  publishGroupPromoteAdmin,
  publishGroupDemoteAdmin,
  publishGroupRemoveParticipant,
  publishGroupUpdateSettings,
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
} from "./client.js";
