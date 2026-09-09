import type { Database } from "@wateaminbox/database";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import { env } from "../lib/env.js";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("ChannelSpineProvisioning");

export interface ChannelSpineDefaults {
  providers: string[];
  writeAuthority: "legacy" | "neutral";
}

/**
 * What a newly created workspace should start with.
 *
 * Absence of a flag row means legacy/off, and that stays the rule: existing
 * workspaces are never changed by this. A deployment that wants new
 * workspaces to arrive with a channel enabled says so explicitly, and each
 * one still gets its own auditable row rather than inheriting a global switch
 * that could enable every workspace at once by misconfiguration.
 *
 * Unset means off, so self-hosted and OSS deployments are unaffected.
 */
export function channelSpineDefaults(): ChannelSpineDefaults | null {
  const providers = env.CHANNEL_SPINE_DEFAULT_PROVIDERS.split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  if (providers.length === 0) return null;
  return { providers, writeAuthority: "neutral" };
}

/**
 * Seed a new workspace's channel-spine flags, when the deployment configures
 * defaults. Failure is logged and swallowed: a workspace that cannot be seeded
 * simply starts legacy/off, which is the safe state, and must never block the
 * signup that created it.
 */
export async function seedChannelSpineFlags(
  trx: Transaction<Database>,
  companyId: string,
  actorUserId: string,
): Promise<void> {
  const defaults = channelSpineDefaults();
  if (!defaults) return;
  const revision = `workspace-default:${env.CHANNEL_SPINE_DEFAULT_REVISION || "unversioned"}`;
  try {
    await trx
      .insertInto("channel_spine_workspace_flags")
      .values({
        company_id: companyId,
        dual_write_enabled: true,
        dual_write_revision: revision,
        shadow_normalization_enabled: true,
        shadow_normalization_revision: revision,
        neutral_reads_enabled: true,
        neutral_read_revision: revision,
        write_authority: defaults.writeAuthority,
        write_authority_revision: revision,
        enabled_providers: sql<string[]>`${defaults.providers}::text[]`,
        provider_enable_revision: revision,
        revision: "1",
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .execute();
  } catch (error) {
    logger.warn(
      { err: formatError(error), companyId },
      "Could not seed channel spine flags; workspace starts on legacy",
    );
  }
}
