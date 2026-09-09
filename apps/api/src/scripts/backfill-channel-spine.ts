import {
  createTenantDatabase,
  db,
  getTenantSchemaName,
} from "@wateaminbox/database";
import { backfillLinkedDeviceTenant } from "../channel-spine/providers/whatsapp-linked-device/backfill";
import { getChannelSpineWorkspaceAuthority } from "../services/channel-spine-authority.service";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  const requested = process.argv
    .filter((argument) => argument.startsWith("--company="))
    .map((argument) => argument.slice("--company=".length));
  const batchArgument = process.argv.find((argument) =>
    argument.startsWith("--batch-size="),
  );
  const batchSize = batchArgument
    ? Number(batchArgument.slice("--batch-size=".length))
    : 250;

  if (!all && requested.length === 0) {
    throw new Error("Select --company=<uuid> or explicitly pass --all");
  }
  let query = db.selectFrom("companies").select("id").orderBy("id");
  if (!all) query = query.where("id", "in", requested);
  const companies = await query.execute();
  if (!apply) {
    console.log(
      `Dry run: ${companies.length} workspace(s) selected. Re-run with --apply after dual write is enabled.`,
    );
    return;
  }

  for (const company of companies) {
    const authority = await getChannelSpineWorkspaceAuthority(company.id);
    if (authority.source !== "configured" || !authority.dualWriteEnabled) {
      throw new Error(
        `Workspace ${company.id} is not configured for channel-spine dual write`,
      );
    }
    const tenantDb = createTenantDatabase(
      process.env.DATABASE_URL || "",
      getTenantSchemaName(company.id),
    );
    try {
      const result = await backfillLinkedDeviceTenant(
        tenantDb,
        company.id,
        batchSize,
      );
      console.log(
        `${company.id}: accounts=${result.accountsProcessed} contacts=${result.contactsProcessed} messages=${result.messagesProcessed} workflows=${result.workflowsProcessed} blocked=${result.blockedRows}`,
      );
      if (result.blockedRows > 0) {
        throw new Error(
          `Workspace ${company.id} has blocked channel-spine rows; inspect its reconciliation journal`,
        );
      }
    } finally {
      await tenantDb.destroy();
    }
  }
}

try {
  await main();
} finally {
  await db.destroy();
}
