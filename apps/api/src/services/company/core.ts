/**
 * Company CRUD operations
 *
 * Core operations for creating, reading, updating, and deleting companies.
 */

import type { Database } from "@whatsapp-web/database";
import { db } from "@whatsapp-web/database";
import { toDbDate } from "@whatsapp-web/shared";
import type { Transaction } from "kysely";
import { CompanyNotFoundError } from "../../lib/errors.js";
import { createTenantSchema, getSchemaName } from "../tenant.service.js";
import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "./types.js";

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
          schema_name: schemaName,
          status: "active",
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .returning([
          "id",
          "name",
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

      return company;
    });

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
    .select(["id", "name", "schema_name", "status", "created_at", "updated_at"])
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

  if (input.name !== undefined) {
    updateData.name = input.name;
  }
  if (input.status !== undefined) {
    updateData.status = input.status;
  }

  const company = await db
    .updateTable("companies")
    .set(updateData)
    .where("id", "=", companyId)
    .where("status", "!=", "deleted")
    .returning([
      "id",
      "name",
      "schema_name",
      "status",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  if (!company) {
    throw new CompanyNotFoundError(companyId);
  }

  return company as unknown as Company;
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
