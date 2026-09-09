/**
 * Set the channel-spine rollout flags for one workspace.
 *
 * This is an operator/development tool, not an API. The flags decide whether a
 * workspace reads and writes through the neutral spine and which providers it
 * may connect, so they are deliberately not editable from the product UI.
 *
 * Usage:
 *   bun run apps/api/src/scripts/set-channel-spine-flags.ts \
 *     --company <uuid> --dual-write --shadow --reads --authority neutral \
 *     --providers telegram_bot
 *
 * Every flag is off unless named. Run with no flags but a company to reset a
 * workspace to legacy. The row's revision advances by exactly one per write,
 * which the table's own trigger enforces and audits.
 */
import { db } from "@wateaminbox/database";
import { sql } from "kysely";

interface Options {
  companyId: string;
  dualWrite: boolean;
  shadow: boolean;
  reads: boolean;
  authority: "legacy" | "neutral";
  providers: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    companyId: "",
    dualWrite: false,
    shadow: false,
    reads: false,
    authority: "legacy",
    providers: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    switch (flag) {
      case "--company":
        options.companyId = argv[++index] ?? "";
        break;
      case "--dual-write":
        options.dualWrite = true;
        break;
      case "--shadow":
        options.shadow = true;
        break;
      case "--reads":
        options.reads = true;
        break;
      case "--authority":
        options.authority = argv[++index] === "neutral" ? "neutral" : "legacy";
        break;
      case "--providers":
        options.providers = (argv[++index] ?? "")
          .split(",")
          .map((provider) => provider.trim())
          .filter(Boolean);
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.companyId) {
    throw new Error("--company <uuid> is required");
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const company = await db
    .selectFrom("companies")
    .select(["id", "name"])
    .where("id", "=", options.companyId)
    .executeTakeFirst();
  if (!company) throw new Error(`No such company: ${options.companyId}`);

  // The flag row records who changed it; use the workspace's oldest owner.
  const actor = await db
    .selectFrom("company_members")
    .select("user_id")
    .where("company_id", "=", company.id)
    .where("role", "=", "owner")
    .orderBy("joined_at", "asc")
    .executeTakeFirst();
  if (!actor) throw new Error("Workspace has no owner to attribute the change");

  // A revision string is required by the table's own CHECKs for any flag that
  // is on, so that a rollout can always be traced to the change that made it.
  const stamp = `local-${new Date().toISOString()}`;
  const values = {
    dual_write_enabled: options.dualWrite,
    dual_write_revision: options.dualWrite ? stamp : null,
    shadow_normalization_enabled: options.shadow,
    shadow_normalization_revision: options.shadow ? stamp : null,
    neutral_reads_enabled: options.reads,
    neutral_read_revision: options.reads ? stamp : null,
    write_authority: options.authority,
    write_authority_revision: options.authority === "neutral" ? stamp : null,
    enabled_providers: options.providers,
    provider_enable_revision: options.providers.length > 0 ? stamp : null,
  };

  const existing = await db
    .selectFrom("channel_spine_workspace_flags")
    .select("revision")
    .where("company_id", "=", company.id)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable("channel_spine_workspace_flags")
      .set({
        ...values,
        enabled_providers: sql<string[]>`${options.providers}::text[]`,
        revision: String(Number(existing.revision) + 1),
        updated_by: actor.user_id,
      })
      .where("company_id", "=", company.id)
      .execute();
  } else {
    await db
      .insertInto("channel_spine_workspace_flags")
      .values({
        ...values,
        company_id: company.id,
        enabled_providers: sql<string[]>`${options.providers}::text[]`,
        revision: "1",
        created_by: actor.user_id,
        updated_by: actor.user_id,
      })
      .execute();
  }

  console.log(`Channel spine flags for ${company.name} (${company.id}):`);
  console.log(`  dual write         ${options.dualWrite}`);
  console.log(`  shadow normalize   ${options.shadow}`);
  console.log(`  neutral reads      ${options.reads}`);
  console.log(`  write authority    ${options.authority}`);
  console.log(
    `  providers          ${options.providers.join(", ") || "(none)"}`,
  );
}

await main();
process.exit(0);
