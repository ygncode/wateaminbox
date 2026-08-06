/**
 * Company CRUD operations
 *
 * Core operations for creating, reading, updating, and deleting companies.
 */

import type { Database } from "@wateaminbox/database";
import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Transaction } from "kysely";
import { CompanyNotFoundError } from "../../lib/errors.js";
import {
  deleteMedia,
  getPresignedUrl,
  uploadMedia,
} from "../../lib/storage.js";
import { seedDefaultSlaPolicy } from "../sla-policy/policy.service.js";
import { createTenantSchema, getSchemaName } from "../tenant.service.js";
import { invalidateCompanyMembership } from "../company-membership.service.js";
import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "./types.js";

async function uploadWorkspaceLogo(
  companyId: string,
  logoDataUrl: string,
): Promise<string> {
  const match = logoDataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/,
  );
  if (!match) throw new Error("Invalid workspace logo");
  const mimeType = match[1];
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const logo = await uploadMedia(
    Buffer.from(match[2], "base64"),
    mimeType,
    companyId,
    `workspace-logo.${extension}`,
  );
  return logo.key;
}

/**
 * Creates a new company with its tenant schema
 */
export async function createCompany(
  input: CreateCompanyInput,
  ownerId: string,
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

  // Create the tenant schema
  await createTenantSchema(companyId);

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
