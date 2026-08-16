/**
 * NATS Command Builder
 * Provides a fluent interface for building and publishing NATS commands
 */

import type {
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
  NatsCommand,
  PostStatusCommand,
  RemoveLabelCommand,
  RequestHistoryCommand,
  SpawnCommand,
  StatusType,
  SyncCatalogProductsCommand,
  SyncCatalogsCommand,
  SyncLabelsCommand,
  UnblockContactCommand,
} from "./types/index.js";

/**
 * Command publisher for a specific company and connection
 * Eliminates the repetitive pattern of building commands, subjects, and publishing
 */
export class NatsCommandPublisher {
  constructor(
    private readonly companyId: string,
    private readonly connectionId: string,
    private readonly publishFn: (
      subject: string,
      command: NatsCommand,
    ) => Promise<void>,
    private readonly buildSubjectFn: (
      companyId: string,
      connectionId: string,
    ) => string,
  ) {}

  /**
   * Publish a generic command with custom payload
   */
  async publish<T extends NatsCommand>(command: T): Promise<void> {
    const subject = this.buildSubjectFn(this.companyId, this.connectionId);
    await this.publishFn(subject, command);
  }

  /**
   * Publish spawn command to start WhatsApp connection
   */
  async spawn(): Promise<void> {
    const command: SpawnCommand = {
      type: "spawn",
      company_id: this.companyId,
      connection_id: this.connectionId,
      tenant_schema: `tenant_${this.companyId.replace(/-/g, "_")}`,
    };

    await this.publish(command);
  }

  /**
   * Publish kill command to disconnect WhatsApp
   */
  async kill(reason?: string, unlink = false): Promise<void> {
    const command: KillCommand = {
      type: "kill",
      company_id: this.companyId,
      connection_id: this.connectionId,
      tenant_schema: `tenant_${this.companyId.replace(/-/g, "_")}`,
      reason,
      unlink,
    };

    await this.publish(command);
  }

  async requestHistory(input: {
    chatJid: string;
    oldestMessageId: string;
    oldestFromMe: boolean;
    oldestTimestamp: string;
    count: number;
  }): Promise<void> {
    const command: RequestHistoryCommand = {
      type: "request_history",
      company_id: this.companyId,
      connection_id: this.connectionId,
      chat_jid: input.chatJid,
      oldest_message_id: input.oldestMessageId,
      oldest_from_me: input.oldestFromMe,
      oldest_timestamp: input.oldestTimestamp,
      count: input.count,
    };
    await this.publish(command);
  }

  /**
   * Publish post status command
   */
  async postStatus(
    statusType: StatusType,
    content: string,
    userId: string,
    mediaUrl?: string,
  ): Promise<void> {
    const command: PostStatusCommand = {
      type: "post_status",
      company_id: this.companyId,
      connection_id: this.connectionId,
      status_type: statusType,
      content,
      user_id: userId,
      media_url: mediaUrl,
    };

    await this.publish(command);
  }

  /**
   * Ask WhatsApp to create a group.
   *
   * The connected account is added by WhatsApp implicitly and must not appear
   * in `participantJids`. The new group only reaches the workspace once the
   * worker reports back what WhatsApp actually created.
   */
  async groupCreate(
    name: string,
    participantJids: string[],
    userId: string,
  ): Promise<void> {
    const command: GroupCreateCommand = {
      type: "group_create",
      company_id: this.companyId,
      connection_id: this.connectionId,
      name,
      participant_jids: participantJids,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group add participants command
   */
  async groupAddParticipants(
    groupJid: string,
    participantJids: string[],
    userId: string,
  ): Promise<void> {
    const command: GroupAddParticipantsCommand = {
      type: "group_add_participants",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jids: participantJids,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group remove participants command
   */
  async groupRemoveParticipants(
    groupJid: string,
    participantJids: string[],
    userId: string,
  ): Promise<void> {
    const command: GroupRemoveParticipantsCommand = {
      type: "group_remove_participants",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jids: participantJids,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group promote admin command
   */
  async groupPromoteAdmin(
    groupJid: string,
    participantJids: string[],
    userId: string,
  ): Promise<void> {
    const command: GroupPromoteAdminCommand = {
      type: "group_promote_admin",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jids: participantJids,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group demote admin command
   */
  async groupDemoteAdmin(
    groupJid: string,
    participantJids: string[],
    userId: string,
  ): Promise<void> {
    const command: GroupDemoteAdminCommand = {
      type: "group_demote_admin",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jids: participantJids,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group update settings command.
   *
   * Only the supplied settings are changed; anything omitted is left as-is.
   */
  async groupUpdateSettings(
    groupJid: string,
    userId: string,
    settings: {
      name?: string;
      description?: string;
      isAnnounce?: boolean;
      isLocked?: boolean;
      isJoinApprovalRequired?: boolean;
      memberAddMode?: string;
    },
  ): Promise<void> {
    const command: GroupUpdateSettingsCommand = {
      type: "group_update_settings",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      user_id: userId,
      ...(settings.name !== undefined ? { name: settings.name } : {}),
      ...(settings.description !== undefined
        ? { description: settings.description }
        : {}),
      ...(settings.isAnnounce !== undefined
        ? { is_announce: settings.isAnnounce }
        : {}),
      ...(settings.isLocked !== undefined
        ? { is_locked: settings.isLocked }
        : {}),
      ...(settings.isJoinApprovalRequired !== undefined
        ? { is_join_approval_required: settings.isJoinApprovalRequired }
        : {}),
      ...(settings.memberAddMode !== undefined
        ? { member_add_mode: settings.memberAddMode }
        : {}),
    };

    await this.publish(command);
  }

  /**
   * Publish group leave command.
   *
   * This ends the connected account's membership only. WhatsApp offers no way
   * to delete or disband a group, so the group survives for its other members.
   */
  async groupLeave(groupJid: string, userId: string): Promise<void> {
    const command: GroupLeaveCommand = {
      type: "group_leave",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group invite link command. When `reset` is true the previous link
   * is revoked, so anything already shared stops working.
   */
  async groupInviteLink(
    groupJid: string,
    reset: boolean,
    userId: string,
  ): Promise<void> {
    const command: GroupInviteLinkCommand = {
      type: "group_invite_link",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      reset,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish a command that re-reads the group's pending join requests.
   */
  async groupFetchJoinRequests(
    groupJid: string,
    userId: string,
  ): Promise<void> {
    const command: GroupJoinRequestsFetchCommand = {
      type: "group_join_requests_fetch",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish an approve/reject decision on pending join requests.
   */
  async groupUpdateJoinRequests(
    groupJid: string,
    participantJids: string[],
    decision: "approve" | "reject",
    userId: string,
  ): Promise<void> {
    const command: GroupJoinRequestsUpdateCommand = {
      type: "group_join_requests_update",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jids: participantJids,
      decision,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish a command that re-reads a group from WhatsApp without changing it.
   */
  async groupSync(groupJid: string, userId: string): Promise<void> {
    const command: GroupSyncCommand = {
      type: "group_sync",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish sync labels command
   */
  async syncLabels(userId: string): Promise<void> {
    const command: SyncLabelsCommand = {
      type: "sync_labels",
      company_id: this.companyId,
      connection_id: this.connectionId,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish apply label command
   */
  async applyLabel(
    labelId: string,
    contactJid: string,
    userId: string,
  ): Promise<void> {
    const command: ApplyLabelCommand = {
      type: "apply_label",
      company_id: this.companyId,
      connection_id: this.connectionId,
      label_id: labelId,
      contact_jid: contactJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish remove label command
   */
  async removeLabel(
    labelId: string,
    contactJid: string,
    userId: string,
  ): Promise<void> {
    const command: RemoveLabelCommand = {
      type: "remove_label",
      company_id: this.companyId,
      connection_id: this.connectionId,
      label_id: labelId,
      contact_jid: contactJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish sync catalogs command
   */
  async syncCatalogs(userId: string): Promise<void> {
    const command: SyncCatalogsCommand = {
      type: "sync_catalogs",
      company_id: this.companyId,
      connection_id: this.connectionId,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish sync catalog products command
   */
  async syncCatalogProducts(catalogId: string, userId: string): Promise<void> {
    const command: SyncCatalogProductsCommand = {
      type: "sync_catalog_products",
      company_id: this.companyId,
      connection_id: this.connectionId,
      catalog_id: catalogId,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish block contact command
   */
  async blockContact(contactJid: string): Promise<void> {
    const command: BlockContactCommand = {
      type: "block_contact",
      company_id: this.companyId,
      connection_id: this.connectionId,
      contact_jid: contactJid,
    };

    await this.publish(command);
  }

  /**
   * Publish unblock contact command
   */
  async unblockContact(contactJid: string): Promise<void> {
    const command: UnblockContactCommand = {
      type: "unblock_contact",
      company_id: this.companyId,
      connection_id: this.connectionId,
      contact_jid: contactJid,
    };

    await this.publish(command);
  }
}

/**
 * Factory function to create a command publisher for a specific connection
 * @example
 * ```typescript
 * const publisher = forConnection(companyId, connectionId, publishCommand, buildCommandSubject)
 * await publisher.spawn()
 * await publisher.syncLabels(userId)
 * ```
 */
export function forConnection(
  companyId: string,
  connectionId: string,
  publishFn: (subject: string, command: NatsCommand) => Promise<void>,
  buildSubjectFn: (companyId: string, connectionId: string) => string,
): NatsCommandPublisher {
  return new NatsCommandPublisher(
    companyId,
    connectionId,
    publishFn,
    buildSubjectFn,
  );
}
