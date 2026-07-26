/**
 * Company member operations
 *
 * Operations for managing company members: listing, roles, permissions, removal.
 */

import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { sql } from "kysely";
import {
  CompanyNotFoundError,
  InsufficientPermissionsError,
} from "../../lib/errors.js";
import { getEffectivePermissions } from "../permission.service.js";
import { getCompany } from "./core.js";
import type { CompanyMember, CompanyWithRole } from "./types.js";

/**
 * Gets all members of a company
 */
export async function getMembers(companyId: string): Promise<CompanyMember[]> {
  // First verify company exists
  await getCompany(companyId);

  const members = await db
    .selectFrom("company_members as cm")
    .innerJoin("users as u", "u.id", "cm.user_id")
    .select([
      "cm.id",
      "cm.user_id",
      "cm.company_id",
      "cm.role",
      "cm.permissions",
      "cm.invited_by",
      "cm.joined_at",
      "u.name",
      "u.email",
    ])
    .where("cm.company_id", "=", companyId)
    .execute();

  return members as unknown as CompanyMember[];
}

/**
 * Gets a specific member's role in a company
 */
export async function getMemberRole(
  companyId: string,
  userId: string,
): Promise<"owner" | "admin" | "member" | null> {
  const member = await db
    .selectFrom("company_members")
    .select(["role"])
    .where("company_id", "=", companyId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  return (member?.role as "owner" | "admin" | "member") || null;
}

/**
 * Checks if a user has permission to perform an action
 */
export async function hasPermission(
  companyId: string,
  userId: string,
  requiredRole: "owner" | "admin" | "member",
): Promise<boolean> {
  const role = await getMemberRole(companyId, userId);
  if (!role) return false;

  const roleHierarchy = { owner: 3, admin: 2, member: 1 };
  return roleHierarchy[role] >= roleHierarchy[requiredRole];
}

/** Hierarchy policy shared by role changes and member removal. */
export function canManageMember(
  actorRole: "owner" | "admin" | "member",
  targetRole: "owner" | "admin" | "member",
): boolean {
  const roleRank = { owner: 3, admin: 2, member: 1 } as const;
  return roleRank[actorRole] > roleRank[targetRole];
}

/**
 * Removes a member from a company
 */
export async function removeMember(
  companyId: string,
  userId: string,
): Promise<void> {
  // Check if user is the owner
  const role = await getMemberRole(companyId, userId);

  if (role === "owner") {
    throw new InsufficientPermissionsError("remove the company owner");
  }

  const result = await db
    .deleteFrom("company_members")
    .where("company_id", "=", companyId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!result.numDeletedRows) {
    throw new CompanyNotFoundError(companyId);
  }

  // Update company stats
  await db
    .updateTable("company_stats")
    .set({
      active_users: sql`GREATEST(active_users - 1, 0)`,
      updated_at: toDbDate(),
    })
    .where("company_id", "=", companyId)
    .execute();
}

/**
 * Updates a member's role
 */
export async function updateMemberRole(
  companyId: string,
  userId: string,
  newRole: "admin" | "member",
): Promise<CompanyMember> {
  // Check current role - can't change owner role
  const currentRole = await getMemberRole(companyId, userId);

  if (currentRole === "owner") {
    throw new InsufficientPermissionsError("change owner's role");
  }

  const member = await db
    .updateTable("company_members")
    .set({ role: newRole })
    .where("company_id", "=", companyId)
    .where("user_id", "=", userId)
    .returning([
      "id",
      "user_id",
      "company_id",
      "role",
      "permissions",
      "invited_by",
      "joined_at",
    ])
    .executeTakeFirst();

  if (!member) {
    throw new CompanyNotFoundError(companyId);
  }

  return member as unknown as CompanyMember;
}

/** Transfer ownership atomically to an existing workspace member. */
export async function transferOwnership(
  companyId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  if (currentOwnerId === newOwnerId) {
    throw new InsufficientPermissionsError("transfer ownership to yourself");
  }
  const [currentRole, targetRole] = await Promise.all([
    getMemberRole(companyId, currentOwnerId),
    getMemberRole(companyId, newOwnerId),
  ]);
  if (currentRole !== "owner" || !targetRole || targetRole === "owner") {
    throw new InsufficientPermissionsError("transfer workspace ownership");
  }

  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("company_members")
      .set({ role: "admin" })
      .where("company_id", "=", companyId)
      .where("user_id", "=", currentOwnerId)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("company_members")
      .set({ role: "owner" })
      .where("company_id", "=", companyId)
      .where("user_id", "=", newOwnerId)
      .executeTakeFirstOrThrow();
  });
}

/**
 * Gets companies a user belongs to
 */
export async function getUserCompanies(
  userId: string,
): Promise<CompanyWithRole[]> {
  const companies = await db
    .selectFrom("company_members as cm")
    .innerJoin("companies as c", "c.id", "cm.company_id")
    .select([
      "c.id",
      "c.name",
      "c.schema_name",
      "c.status",
      "c.created_at",
      "c.updated_at",
      "cm.role",
      "cm.permissions",
    ])
    .where("cm.user_id", "=", userId)
    .where("c.status", "!=", "deleted")
    .execute();

  return companies.map((company) => ({
    ...company,
    permissions: getEffectivePermissions(
      company.role,
      (company.permissions ?? {}) as Record<string, boolean>,
    ),
  })) as unknown as CompanyWithRole[];
}
