/**
 * Company CRUD operations
 *
 * Core operations for creating, reading, updating, and deleting companies.
 */

import type { Database } from "@wateaminbox/database";
import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Transaction } from "kysely";
import { CompanyNotFoundError, ValidationError } from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { sniffMediaType } from "../../lib/media-sniff.js";
import { seedChannelSpineFlags } from "../channel-spine-provisioning.service.js";
import {
  deleteMedia,
  getPresignedUrl,
  uploadMedia,
} from "../../lib/storage.js";
import { invalidateCompanyMembership } from "../company-membership.service.js";
import { seedDefaultSlaPolicy } from "../sla-policy/policy.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
} from "../tenant.service.js";
import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "./types.js";

const logger = createLogger("company-service");

type ImageUploader = (
  data: Buffer | Uint8Array,
  mimeType: string,
  companyId: string,
  filename?: string,
) => Promise<{ key: string }>;

export async function uploadWorkspaceLogo(
  companyId: string,
  logoDataUrl: string,
  upload: ImageUploader = uploadMedia,
): Promise<string> {
  const match = logoDataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/,
  );
  if (!match) throw new ValidationError("Invalid workspace logo");
  const mimeType = match[1];
  const decoded = Buffer.from(match[2], "base64");
  const sniffed = sniffMediaType(decoded);
  if (!sniffed || sniffed.mimeType !== mimeType) {
    throw new ValidationError("Invalid workspace logo");
  }
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const logo = await upload(
    decoded,
    mimeType,
    companyId,
    `workspace-logo.${extension}`,
  );
  return logo.key;
}

/**
 * Compensates for a workspace whose tenant schema did not finish provisioning.
 *
 * The `companies` row commits as `active` before the schema exists, so a
 * transient provisioning failure used to leave a workspace the user could see
 * and select but whose every tenant-scoped request failed with "relation does
 * not exist", plus an orphan PostgreSQL schema when provisioning had got far
 * enough to create one. Drop whatever exists and hide the row, which is the
 * same terminal state `deleteCompany` puts a workspace in - `getUserCompanies`
 * filters `status != 'deleted'` - so the failure is recoverable by creating the
 * workspace again.
 *
 * Both steps are best effort: the caller rethrows the original provisioning
 * error, and a compensation failure must not replace it.
 */
async function rollbackFailedWorkspace(companyId: string): Promise<void> {
  try {
    // Idempotent, and covers both a missing schema and a half-built one.
    await dropTenantSchema(companyId);
  } catch (error) {
    logger.error(
      { err: formatError(error), companyId },
      "Could not drop the tenant schema of a workspace whose provisioning failed",
    );
  }

  await db
    .updateTable("companies")
    .set({ status: "deleted", updated_at: toDbDate() })
    .where("id", "=", companyId)
    .execute();

  invalidateCompanyMembership(companyId);
}

/**
 * Creates a new company with its tenant schema
 */
export async function createCompany(
  input: CreateCompanyInput,
  ownerId: string,
  provisionTenantSchema: (
    companyId: string,
  ) => Promise<void> = createTenantSchema,
): Promise<Company> {
  // Generate a unique ID for the company (will be used for schema name)
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  let logoKey: string | null = null;

  if (input.logoDataUrl) {
    logoKey = await uploadWorkspaceLogo(companyId, input.logoDataUrl);
  }

  // Start a transaction
  const result = await db
    .transaction()
    .execute(async (trx: Transaction<Database>) => {
      // Create the company record
      const company = await trx
        .insertInto("companies")
        .values({
          id: companyId,
          name: input.name,
          description: input.description ?? null,
          logo_key: logoKey,
          schema_name: schemaName,
          status: "active",
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .returning([
          "id",
          "name",
          "description",
          "logo_key",
          "schema_name",
          "status",
          "created_at",
          "updated_at",
        ])
        .executeTakeFirstOrThrow();

      // Create company stats record
      await trx
        .insertInto("company_stats")
        .values({
          company_id: companyId,
          total_messages: 0,
          total_contacts: 0,
          active_users: 1,
          updated_at: toDbDate(),
        })
        .execute();

      // New workspaces inherit the deployment's channel defaults, when it
      // configures any. Existing workspaces are never touched by this.
      await seedChannelSpineFlags(trx, companyId, ownerId);

      // Add the owner as a member
      await trx
        .insertInto("company_members")
        .values({
          user_id: ownerId,
          company_id: companyId,
          role: "owner",
          permissions: {},
          joined_at: toDbDate(),
        })
        .execute();

      await seedDefaultSlaPolicy(trx, companyId);

      return company;
    });

  // A brand-new workspace has no cached membership, but invalidating keeps the
  // "every company_members write invalidates" rule literally true.
  invalidateCompanyMembership(companyId);

  // Create the tenant schema. This cannot join the transaction above - it runs
  // on the shared tenant pool, which is a different connection - so the row is
  // already committed by the time it runs and a failure here has to be
  // compensated rather than rolled back.
  try {
    await provisionTenantSchema(companyId);
  } catch (error) {
    await rollbackFailedWorkspace(companyId);
    throw error;
  }

  return result as unknown as Company;
}

/**
 * Gets a company by ID
 */
export async function getCompany(companyId: string): Promise<Company> {
  const company = await db
    .selectFrom("companies")
    .select([
      "id",
      "name",
      "description",
      "logo_key",
      "schema_name",
      "status",
      "created_at",
      "updated_at",
    ])
    .where("id", "=", companyId)
    .where("status", "!=", "deleted")
    .executeTakeFirst();

  if (!company) {
    throw new CompanyNotFoundError(companyId);
  }

  return company as unknown as Company;
}

/**
 * Updates a company
 */
export async function updateCompany(
  companyId: string,
  input: UpdateCompanyInput,
): Promise<Company> {
  const updateData: Record<string, unknown> = {
    updated_at: toDbDate(),
  };
  let previousLogoKey: string | null = null;
  let uploadedLogoKey: string | null = null;

  if (input.name !== undefined) {
    updateData.name = input.name;
  }
  if (input.description !== undefined) {
    updateData.description = input.description || null;
  }
  if (input.logoDataUrl !== undefined) {
    const current = await getCompany(companyId);
    previousLogoKey = current.logo_key;
    if (input.logoDataUrl === null) {
      updateData.logo_key = null;
    } else {
      uploadedLogoKey = await uploadWorkspaceLogo(companyId, input.logoDataUrl);
      updateData.logo_key = uploadedLogoKey;
    }
  }
  if (input.status !== undefined) {
    updateData.status = input.status;
  }

  let company: Company | undefined;
  try {
    company = (await db
      .updateTable("companies")
      .set(updateData)
      .where("id", "=", companyId)
      .where("status", "!=", "deleted")
      .returning([
        "id",
        "name",
        "description",
        "logo_key",
        "schema_name",
        "status",
        "created_at",
        "updated_at",
      ])
      .executeTakeFirst()) as Company | undefined;
  } catch (error) {
    if (uploadedLogoKey) {
      await deleteMedia(uploadedLogoKey).catch(() => undefined);
    }
    throw error;
  }

  if (!company) {
    if (uploadedLogoKey) {
      await deleteMedia(uploadedLogoKey).catch(() => undefined);
    }
    throw new CompanyNotFoundError(companyId);
  }

  if (previousLogoKey && previousLogoKey !== company.logo_key) {
    await deleteMedia(previousLogoKey).catch(() => undefined);
  }

  return company;
}

export async function toCompanyResponse(company: Company) {
  const logoKey = company.logo_key;
  let logoUrl: string | null = null;
  if (logoKey) {
    try {
      logoUrl = await getPresignedUrl(logoKey, 3600);
    } catch {
      // Workspace access should not fail when object storage is temporarily
      // unavailable. The monogram remains a usable fallback.
    }
  }
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    status: company.status,
    logoUrl,
    createdAt: company.created_at.toISOString(),
    updatedAt: company.updated_at.toISOString(),
  };
}

/**
 * Soft deletes a company
 */
export async function deleteCompany(companyId: string): Promise<void> {
  const result = await db
    .updateTable("companies")
    .set({
      status: "deleted",
      updated_at: toDbDate(),
    })
    .where("id", "=", companyId)
    .where("status", "!=", "deleted")
    .executeTakeFirst();

  if (!result.numUpdatedRows) {
    throw new CompanyNotFoundError(companyId);
  }

  // Optionally drop the tenant schema (can be made configurable)
  // await dropTenantSchema(companyId);
}
