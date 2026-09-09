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
 * `--all` applies the same settings to every active workspace, and `--dry-run`
 * prints what would change without writing. A staged rollout is still the
 * documented path: enable a few workspaces, watch them, then widen.
 *
 * Every flag is off unless named. Run with no flags but a company to reset a
 * workspace to legacy. The row's revision advances by exactly one per write,
 * which the table's own trigger enforces and audits.
 */
import { db } from "@wateaminbox/database";
import { sql } from "kysely";

interface Options {
  companyId: string;
  allCompanies: boolean;
  dryRun: boolean;
  dualWrite: boolean;
  shadow: boolean;
  reads: boolean;
  authority: "legacy" | "neutral";
  providers: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    companyId: "",
    allCompanies: false,
    dryRun: false,
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
      case "--all":
        options.allCompanies = true;
        break;
      case "--dry-run":
        options.dryRun = true;
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
  if (!options.companyId && !options.allCompanies) {
    throw new Error("--company <uuid> or --all is required");
  }
  if (options.companyId && options.allCompanies) {
    throw new Error("--company and --all are mutually exclusive");
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const companies = options.allCompanies
    ? await db
        .selectFrom("companies")
        .select(["id", "name"])
        .where("status", "=", "active")
        .orderBy("created_at", "asc")
        .execute()
    : await db
        .selectFrom("companies")
        .select(["id", "name"])
        .where("id", "=", options.companyId)
        .execute();
  if (companies.length === 0) {
    throw new Error(
      options.allCompanies
        ? "No active workspaces"
        : `No such company: ${options.companyId}`,
    );
  }

  // One stamp for the whole run, so every workspace changed together shares a
  // revision and the audit trail shows them as one rollout step.
  const stamp = `rollout-${new Date().toISOString()}`;
  let changed = 0;
  let skipped = 0;
  for (const company of companies) {
    const actor = await db
      .selectFrom("company_members")
      .select("user_id")
      .where("company_id", "=", company.id)
      .where("role", "=", "owner")
      .orderBy("joined_at", "asc")
      .executeTakeFirst();
    if (!actor) {
      // A workspace with no owner has nobody to attribute the change to.
      // Skipping keeps a bulk run going rather than aborting partway.
      console.log(`  skip ${company.name}: no owner to attribute the change`);
      skipped++;
      continue;
    }

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

    if (options.dryRun) {
      console.log(
        `  would ${existing ? "update" : "create"} ${company.name}: authority=${options.authority} providers=${options.providers.join(",") || "(none)"}`,
      );
      changed++;
      continue;
    }

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
    console.log(`  ${existing ? "updated" : "created"} ${company.name}`);
    changed++;
  }

  console.log(
    `${options.dryRun ? "Dry run: " : ""}${changed} workspace(s) ${options.dryRun ? "would change" : "changed"}, ${skipped} skipped.`,
  );
  console.log(`  dual write       ${options.dualWrite}`);
  console.log(`  shadow normalize ${options.shadow}`);
  console.log(`  neutral reads    ${options.reads}`);
  console.log(`  write authority  ${options.authority}`);
  console.log(`  providers        ${options.providers.join(", ") || "(none)"}`);
}

await main();
process.exit(0);
