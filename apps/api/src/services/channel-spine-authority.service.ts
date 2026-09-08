import {
  db,
  type ChannelSpineWriteAuthority,
  type Database,
} from "@wateaminbox/database";
import type { Kysely } from "kysely";

export type ChannelSpineFlagSource =
  | "configured"
  | "absent"
  | "invalid"
  | "unavailable";
export interface ChannelSpineWorkspaceAuthority {
  dualWriteEnabled: boolean;
  dualWriteRevision: string | null;
  neutralReadsEnabled: boolean;
  neutralReadRevision: string | null;
  shadowNormalizationEnabled: boolean;
  shadowNormalizationRevision: string | null;
  writeAuthority: ChannelSpineWriteAuthority;
  writeAuthorityRevision: string | null;
  enabledProviders: readonly string[];
  providerEnableRevision: string | null;
  revision: string | null;
  source: ChannelSpineFlagSource;
}
type AuthorityDatabase = Pick<Kysely<Database>, "selectFrom">;
type FlagRow = Omit<ChannelSpineWorkspaceAuthority, "source">;

interface StoredFlagRow {
  dual_write_enabled: boolean;
  dual_write_revision: string | null;
  neutral_reads_enabled: boolean;
  neutral_read_revision: string | null;
  shadow_normalization_enabled: boolean;
  shadow_normalization_revision: string | null;
  write_authority: ChannelSpineWriteAuthority;
  write_authority_revision: string | null;
  enabled_providers: string[];
  provider_enable_revision: string | null;
  revision: string;
}

/** Direct DB read on every decision: errors, missing rows, and invalid rows fail legacy/off. */
export async function getChannelSpineWorkspaceAuthority(
  companyId: string,
  database: AuthorityDatabase = db,
): Promise<ChannelSpineWorkspaceAuthority> {
  let row: StoredFlagRow | undefined;
  try {
    row = await database
      .selectFrom("channel_spine_workspace_flags")
      .select([
        "dual_write_enabled",
        "dual_write_revision",
        "neutral_reads_enabled",
        "neutral_read_revision",
        "shadow_normalization_enabled",
        "shadow_normalization_revision",
        "write_authority",
        "write_authority_revision",
        "enabled_providers",
        "provider_enable_revision",
        "revision",
      ])
      .where("company_id", "=", companyId)
      .executeTakeFirst();
  } catch {
    return legacyAuthority("unavailable");
  }
  if (!row) return legacyAuthority("absent");
  const candidate: FlagRow = {
    dualWriteEnabled: row.dual_write_enabled,
    dualWriteRevision: row.dual_write_revision,
    neutralReadsEnabled: row.neutral_reads_enabled,
    neutralReadRevision: row.neutral_read_revision,
    shadowNormalizationEnabled: row.shadow_normalization_enabled,
    shadowNormalizationRevision: row.shadow_normalization_revision,
    writeAuthority: row.write_authority,
    writeAuthorityRevision: row.write_authority_revision,
    enabledProviders: row.enabled_providers,
    providerEnableRevision: row.provider_enable_revision,
    revision: row.revision,
  };
  return isValid(candidate)
    ? {
        ...candidate,
        enabledProviders: [...candidate.enabledProviders],
        source: "configured",
      }
    : legacyAuthority("invalid");
}
export function isChannelProviderEnabled(
  authority: ChannelSpineWorkspaceAuthority,
  provider: string,
): boolean {
  return (
    authority.source === "configured" &&
    authority.enabledProviders.includes(provider)
  );
}
function legacyAuthority(
  source: Exclude<ChannelSpineFlagSource, "configured">,
): ChannelSpineWorkspaceAuthority {
  return {
    dualWriteEnabled: false,
    dualWriteRevision: null,
    neutralReadsEnabled: false,
    neutralReadRevision: null,
    shadowNormalizationEnabled: false,
    shadowNormalizationRevision: null,
    writeAuthority: "legacy",
    writeAuthorityRevision: null,
    enabledProviders: [],
    providerEnableRevision: null,
    revision: null,
    source,
  };
}
function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isValid(value: FlagRow): boolean {
  if (
    !value.revision ||
    !/^\d+$/.test(value.revision) ||
    BigInt(value.revision) < 1n
  )
    return false;
  if (value.writeAuthority !== "legacy" && value.writeAuthority !== "neutral")
    return false;
  if (value.dualWriteEnabled && !nonBlank(value.dualWriteRevision))
    return false;
  if (value.neutralReadsEnabled && !nonBlank(value.neutralReadRevision))
    return false;
  if (
    value.shadowNormalizationEnabled &&
    !nonBlank(value.shadowNormalizationRevision)
  )
    return false;
  if (
    value.writeAuthority === "neutral" &&
    !nonBlank(value.writeAuthorityRevision)
  )
    return false;
  if (
    !Array.isArray(value.enabledProviders) ||
    value.enabledProviders.some((key) => !nonBlank(key)) ||
    new Set(value.enabledProviders).size !== value.enabledProviders.length
  )
    return false;
  return (
    value.enabledProviders.length === 0 ||
    nonBlank(value.providerEnableRevision)
  );
}
