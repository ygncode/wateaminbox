/**
 * Shared NATS mock configuration for all tests
 *
 * This ensures consistent mocking across all test files that directly or indirectly
 * use the nats module, preventing module loading errors when tests run together.
 */

import { mock } from "bun:test";

export const NATS_MOCK_EXPORTS = {
  buildCommandSubject: (companyId: string, connectionId: string) =>
    `WHATSAPP.commands.${companyId}.${connectionId}`,
  publishSpawnCommand: mock(async () => {}),
  publishKillCommand: mock(async () => {}),
  publishSendMessage: mock(async () => {}),
  publishPostStatus: mock(async () => {}),
  publishGroupPromoteAdmin: mock(async () => {}),
  publishGroupDemoteAdmin: mock(async () => {}),
  publishGroupRemoveParticipant: mock(async () => {}),
  publishGroupUpdateSettings: mock(async () => {}),
  publishSyncLabels: mock(async () => {}),
  publishApplyLabel: mock(async () => {}),
  publishRemoveLabel: mock(async () => {}),
  publishSyncCatalogs: mock(async () => {}),
  publishSyncCatalogProducts: mock(async () => {}),
  publishSendReaction: mock(async () => {}),
  publishCommand: mock(async () => {}),
  getNatsConnection: mock(async () => ({ status: 'ok' })),
  getJetStreamClient: mock(async () => ({ status: 'ok' })),
  subscribe: mock(async () => {}),
  subscribeToCompanyEvents: mock(async () => {}),
  subscribeToConnectionEvents: mock(async () => {}),
  subscribeToAllEvents: mock(async () => {}),
  closeNatsConnection: mock(async () => {}),
  isNatsConnected: mock(() => true),
  request: mock(async () => ({})),
  NATS_SUBJECTS: {
    SPAWN: 'whatsapp.spawn',
    KILL: 'whatsapp.kill',
    SEND_MESSAGE: 'whatsapp.send-message',
    POST_STATUS: 'whatsapp.post-status',
    GROUP_PROMOTE_ADMIN: 'whatsapp.group.promote-admin',
    GROUP_DEMOTE_ADMIN: 'whatsapp.group.demote-admin',
    GROUP_REMOVE_PARTICIPANT: 'whatsapp.group.remove-participant',
    GROUP_UPDATE_SETTINGS: 'whatsapp.group.update-settings',
    SYNC_LABELS: 'whatsapp.sync-labels',
    APPLY_LABEL: 'whatsapp.apply-label',
    REMOVE_LABEL: 'whatsapp.remove-label',
    SEND_REACTION: 'whatsapp.send-reaction',
    SYNC_CATALOGS: 'whatsapp.sync-catalogs',
    SYNC_CATALOG_PRODUCTS: 'whatsapp.sync-catalog-products',
    QR_CODE: 'whatsapp.events.qr',
    CONNECTION_UPDATE: 'whatsapp.events.connection',
    MESSAGE: 'whatsapp.events.message',
    RECEIPT: 'whatsapp.events.receipt',
    SEND_CONFIRMATION: 'whatsapp.events.send-confirmation',
    STATUS_UPDATE: 'whatsapp.events.status',
    CONTACT_UPDATE: 'whatsapp.events.contact',
    PRESENCE: 'whatsapp.events.presence',
    TYPING: 'whatsapp.events.typing',
    MESSAGE_REVOKE: 'whatsapp.events.message-revoke',
    REACTION: 'whatsapp.events.reaction',
    PROFILE_PICTURE: 'whatsapp.events.profile-picture',
    LABELS: 'whatsapp.events.labels',
    CATALOGS: 'whatsapp.events.catalogs',
    CATALOG_PRODUCTS: 'whatsapp.events.catalog-products',
  },
};

/**
 * Creates a NATS mock with optional custom overrides
 *
 * Usage in test files:
 * ```ts
 * import { createNatsMock } from '../helpers/nats-mock';
 * const mockPublishSendMessage = mock(async () => {});
 *
 * mock.module("../../lib/nats.js", () => createNatsMock({
 *   publishSendMessage: mockPublishSendMessage
 * }));
 * ```
 */
export function createNatsMock(overrides = {}) {
  return {
    ...NATS_MOCK_EXPORTS,
    ...overrides,
  };
}
