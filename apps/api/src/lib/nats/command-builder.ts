/**
 * NATS Command Builder
 * Provides a fluent interface for building and publishing NATS commands
 */

import type {
  NatsCommand,
  MessageType,
  StatusType,
  SpawnCommand,
  KillCommand,
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
  async spawn(databaseUrl: string): Promise<void> {
    // Ensure sslmode is set for local development
    let dbUrl = databaseUrl;
    if (dbUrl && !dbUrl.includes("sslmode=")) {
      dbUrl += dbUrl.includes("?") ? "&sslmode=disable" : "?sslmode=disable";
    }

    const command: SpawnCommand = {
      type: "spawn",
      company_id: this.companyId,
      connection_id: this.connectionId,
      tenant_schema: `tenant_${this.companyId.replace(/-/g, "_")}`,
      database_url: dbUrl,
    };

    await this.publish(command);
  }

  /**
   * Publish kill command to disconnect WhatsApp
   */
  async kill(reason?: string): Promise<void> {
    const command: KillCommand = {
      type: "kill",
      company_id: this.companyId,
      connection_id: this.connectionId,
      reason,
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
   * Publish group promote admin command
   */
  async groupPromoteAdmin(
    groupJid: string,
    participantJid: string,
    userId: string,
  ): Promise<void> {
    const command: GroupPromoteAdminCommand = {
      type: "group_promote_admin",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jid: participantJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group demote admin command
   */
  async groupDemoteAdmin(
    groupJid: string,
    participantJid: string,
    userId: string,
  ): Promise<void> {
    const command: GroupDemoteAdminCommand = {
      type: "group_demote_admin",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jid: participantJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group remove participant command
   */
  async groupRemoveParticipant(
    groupJid: string,
    participantJid: string,
    userId: string,
  ): Promise<void> {
    const command: GroupRemoveParticipantCommand = {
      type: "group_remove_participant",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      participant_jid: participantJid,
      user_id: userId,
    };

    await this.publish(command);
  }

  /**
   * Publish group update settings command
   */
  async groupUpdateSettings(
    groupJid: string,
    userId: string,
    name?: string,
    description?: string,
  ): Promise<void> {
    const command: GroupUpdateSettingsCommand = {
      type: "group_update_settings",
      company_id: this.companyId,
      connection_id: this.connectionId,
      group_jid: groupJid,
      user_id: userId,
      name,
      description,
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
 * await publisher.spawn(databaseUrl)
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
