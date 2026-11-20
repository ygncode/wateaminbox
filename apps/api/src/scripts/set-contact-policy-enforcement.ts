/**
 * Turn customer suppression enforcement on or off for one workspace (contact
 * blocking, phase 2).
 *
 * When on, the workspace drops new inbound from a blocked customer on every
 * channel, keeps a muted customer's messages quiet, and refuses outbound to a
 * blocked or do-not-contact customer. When off, behaviour is exactly as before
 * this feature: only WhatsApp's own `is_blocked` applies.
 *
 * Operator tool, not an API. Usage:
 *   bun run apps/api/src/scripts/set-contact-policy-enforcement.ts \
 *     --company <uuid> --on|--off [--dry-run]
 *
 * `--all` applies to every active workspace. Roll out a few workspaces first.
 */
import { db, SYSTEM_SUPPRESSION_ACTOR } from "@wateaminbox/database";
import { getTenantConnection } from "../services/tenant.service.js";

interface Options {
  companyId: string;
  allCompanies: boolean;
  enabled: boolean | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    companyId: "",
    allCompanies: false,
    enabled: null,
    dryRun: false,
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
      case "--on":
        options.enabled = true;
        break;
      case "--off":
        options.enabled = false;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.companyId === !options.allCompanies) {
    throw new Error("Exactly one of --company <uuid> or --all is required");
  }
  if (options.enabled === null) throw new Error("--on or --off is required");
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const enabled = options.enabled === true;
  const companies = await db
    .selectFrom("companies")
    .select(["id", "name"])
    .where("status", "=", "active")
    .$if(!options.allCompanies, (qb) => qb.where("id", "=", options.companyId))
    .orderBy("created_at", "asc")
    .execute();
  if (companies.length === 0) throw new Error("No matching active workspace");

  for (const company of companies) {
    if (options.dryRun) {
      console.log(`  would set ${company.name}: enforcement=${enabled}`);
      continue;
    }
    await getTenantConnection(company.id)
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto("contact_policy_settings")
          .values({
            id: 1,
            enforcement_enabled: enabled,
            updated_by: SYSTEM_SUPPRESSION_ACTOR,
          })
          .onConflict((conflict) =>
            conflict.column("id").doUpdateSet({
              enforcement_enabled: enabled,
              updated_by: SYSTEM_SUPPRESSION_ACTOR,
              updated_at: new Date(),
            }),
          )
          .execute();
        await trx
          .insertInto("audit_logs")
          .values({
            user_id: null,
            action: enabled
              ? "contact_policy.enforcement_enabled"
              : "contact_policy.enforcement_disabled",
            entity_type: "company",
            entity_id: company.id,
            details: { source: "set-contact-policy-enforcement" },
            ip_address: null,
          })
          .execute();
      });
    console.log(`  ${company.name}: enforcement=${enabled}`);
  }
  console.log(
    `${options.dryRun ? "Dry run: " : ""}${companies.length} workspace(s).`,
  );
}

await main();
process.exit(0);
