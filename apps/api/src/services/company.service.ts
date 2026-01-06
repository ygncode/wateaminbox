import { sql } from "kysely";
import type { Transaction } from "kysely";
import { randomBytes } from "crypto";
import { createTenantSchema, getSchemaName } from "./tenant.service.js";
import { db } from "@whatsapp-web/database";
import type { Database } from "@whatsapp-web/database";
import { sendInvitationEmail } from "../lib/email.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("CompanyService");

// Types for company operations
export interface Company {
  id: string;
  name: string;
  schema_name: string;
  status: "active" | "suspended" | "deleted";
  created_at: Date;
  updated_at: Date;
}

export interface CompanyMember {
  id: string;
  user_id: string;
  company_id: string;
  role: "owner" | "admin" | "member";
  permissions: Record<string, unknown>;
  invited_by: string | null;
  joined_at: Date;
  // Joined user data
  email?: string;
}

export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  token: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

export interface CreateCompanyInput {
  name: string;
}

export interface UpdateCompanyInput {
  name?: string;
  status?: "active" | "suspended";
}

export interface InviteMemberInput {
  email: string;
  role?: "admin" | "member";
}

export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company with ID ${companyId} not found`);
    this.name = "CompanyNotFoundError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor(token: string) {
    super(`Invitation with token ${token} not found or expired`);
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends Error {
  constructor() {
    super("Invitation has expired");
    this.name = "InvitationExpiredError";
  }
}

export class UserAlreadyMemberError extends Error {
  constructor(email: string) {
    super(`User ${email} is already a member of this company`);
    this.name = "UserAlreadyMemberError";
  }
}

export class InsufficientPermissionsError extends Error {
  constructor(action: string) {
    super(`Insufficient permissions to ${action}`);
    this.name = "InsufficientPermissionsError";
  }
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

  // Start a transaction
  const result = await db.transaction().execute(async (trx: Transaction<Database>) => {
    // Create the company record
    const company = await trx
      .insertInto("companies")
      .values({
        id: companyId,
        name: input.name,
        schema_name: schemaName,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
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
        updated_at: new Date(),
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
        joined_at: new Date(),
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
    updated_at: new Date(),
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
      updated_at: new Date(),
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

/**
 * Creates an invitation to join a company
 */
export async function inviteMember(
  companyId: string,
  input: InviteMemberInput,
  invitedBy: string,
): Promise<Invitation> {
  // Verify company exists and get company name
  const company = await getCompany(companyId);

  // Get inviter email
  const inviter = await db
    .selectFrom("users")
    .select(["email"])
    .where("id", "=", invitedBy)
    .executeTakeFirst();

  const inviterEmail = inviter?.email || "A team member";

  // Check if user is already a member
  const existingUser = await db
    .selectFrom("users as u")
    .innerJoin("company_members as cm", "cm.user_id", "u.id")
    .where("u.email", "=", input.email)
    .where("cm.company_id", "=", companyId)
    .executeTakeFirst();

  if (existingUser) {
    throw new UserAlreadyMemberError(input.email);
  }

  // Check if there's already a pending invitation
  const existingInvitation = await db
    .selectFrom("invitations")
    .select(["id"])
    .where("company_id", "=", companyId)
    .where("email", "=", input.email)
    .where("accepted_at", "is", null)
    .where("expires_at", ">", new Date())
    .executeTakeFirst();

  if (existingInvitation) {
    // Cancel existing invitation and create new one
    await db
      .deleteFrom("invitations")
      .where("id", "=", existingInvitation.id)
      .execute();
  }

  // Generate a secure token
  const token = randomBytes(32).toString("hex");

  // Set expiration to 7 days from now
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const invitation = await db
    .insertInto("invitations")
    .values({
      company_id: companyId,
      email: input.email,
      token,
      invited_by: invitedBy,
      expires_at: expiresAt,
      created_at: new Date(),
    })
    .returning([
      "id",
      "company_id",
      "email",
      "token",
      "invited_by",
      "expires_at",
      "accepted_at",
      "created_at",
    ])
    .executeTakeFirstOrThrow();

  // Send invitation email (fire and forget, don't block on email delivery)
  sendInvitationEmail(input.email, token, company.name, inviterEmail)
    .then((result) => {
      if (!result.success) {
        logger.warn(
          { email: input.email, error: result.error },
          "Failed to send invitation email",
        );
      }
    })
    .catch((err) => {
      logger.error(
        { email: input.email, error: err },
        "Error sending invitation email",
      );
    });

  return invitation as unknown as Invitation;
}

/**
 * Gets pending invitations for a company
 */
export async function getPendingInvitations(
  companyId: string,
): Promise<Invitation[]> {
  const invitations = await db
    .selectFrom("invitations")
    .select([
      "id",
      "company_id",
      "email",
      "token",
      "invited_by",
      "expires_at",
      "accepted_at",
      "created_at",
    ])
    .where("company_id", "=", companyId)
    .where("accepted_at", "is", null)
    .where("expires_at", ">", new Date())
    .execute();

  return invitations as unknown as Invitation[];
}

/**
 * Cancels an invitation
 */
export async function cancelInvitation(
  companyId: string,
  invitationId: string,
): Promise<void> {
  const result = await db
    .deleteFrom("invitations")
    .where("id", "=", invitationId)
    .where("company_id", "=", companyId)
    .where("accepted_at", "is", null)
    .executeTakeFirst();

  if (!result.numDeletedRows) {
    throw new InvitationNotFoundError(invitationId);
  }
}

/**
 * Accepts an invitation using a token
 */
export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<{ company: Company; member: CompanyMember }> {
  // Find the invitation
  const invitation = await db
    .selectFrom("invitations")
    .select([
      "id",
      "company_id",
      "email",
      "invited_by",
      "expires_at",
      "accepted_at",
    ])
    .where("token", "=", token)
    .where("accepted_at", "is", null)
    .executeTakeFirst();

  if (!invitation) {
    throw new InvitationNotFoundError(token);
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new InvitationExpiredError();
  }

  // Start a transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction().execute(async (trx: any) => {
    // Mark invitation as accepted
    await trx
      .updateTable("invitations")
      .set({ accepted_at: new Date() })
      .where("id", "=", invitation.id)
      .execute();

    // Add user as a member
    const member = await trx
      .insertInto("company_members")
      .values({
        user_id: userId,
        company_id: invitation.company_id,
        role: "member",
        permissions: {},
        invited_by: invitation.invited_by,
        joined_at: new Date(),
      })
      .returning([
        "id",
        "user_id",
        "company_id",
        "role",
        "permissions",
        "invited_by",
        "joined_at",
      ])
      .executeTakeFirstOrThrow();

    // Update company stats
    await trx
      .updateTable("company_stats")
      .set({
        active_users: sql`active_users + 1`,
        updated_at: new Date(),
      })
      .where("company_id", "=", invitation.company_id)
      .execute();

    return member;
  });

  const company = await getCompany(invitation.company_id);

  return {
    company,
    member: result as unknown as CompanyMember,
  };
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
      updated_at: new Date(),
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

/**
 * Gets companies a user belongs to
 */
export async function getUserCompanies(
  userId: string,
): Promise<(Company & { role: string })[]> {
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
    ])
    .where("cm.user_id", "=", userId)
    .where("c.status", "!=", "deleted")
    .execute();

  return companies as unknown as (Company & { role: string })[];
}

/**
 * Gets invitation by token (for preview before accepting)
 */
export async function getInvitationByToken(token: string): Promise<{
  id: string;
  email: string;
  companyName: string;
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}> {
  const result = await db
    .selectFrom("invitations as i")
    .innerJoin("companies as c", "c.id", "i.company_id")
    .innerJoin("users as u", "u.id", "i.invited_by")
    .select([
      "i.id",
      "i.email",
      "i.expires_at",
      "i.accepted_at",
      "i.created_at",
      "c.name as company_name",
      "u.email as inviter_email",
    ])
    .where("i.token", "=", token)
    .executeTakeFirst();

  if (!result) {
    throw new InvitationNotFoundError(token);
  }

  if (result.accepted_at) {
    throw new InvitationNotFoundError(token);
  }

  if (new Date(result.expires_at) < new Date()) {
    throw new InvitationExpiredError();
  }

  return {
    id: result.id,
    email: result.email,
    companyName: result.company_name,
    invitedBy: result.inviter_email,
    expiresAt: result.expires_at,
    createdAt: result.created_at,
  };
}

/**
 * Resends an invitation (extends expiry and sends email)
 */
export async function resendInvitation(
  companyId: string,
  invitationId: string,
  userId: string,
): Promise<Invitation> {
  // Get company name
  const company = await getCompany(companyId);

  // Get resender email
  const resender = await db
    .selectFrom("users")
    .select(["email"])
    .where("id", "=", userId)
    .executeTakeFirst();

  const resenderEmail = resender?.email || "A team member";

  // Find the invitation
  const invitation = await db
    .selectFrom("invitations")
    .select([
      "id",
      "company_id",
      "email",
      "token",
      "invited_by",
      "expires_at",
      "accepted_at",
      "created_at",
    ])
    .where("id", "=", invitationId)
    .where("company_id", "=", companyId)
    .where("accepted_at", "is", null)
    .executeTakeFirst();

  if (!invitation) {
    throw new InvitationNotFoundError(invitationId);
  }

  // Generate new token and extend expiry
  const newToken = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const updated = await db
    .updateTable("invitations")
    .set({
      token: newToken,
      expires_at: expiresAt,
      invited_by: userId, // Update to current resender
    })
    .where("id", "=", invitationId)
    .returning([
      "id",
      "company_id",
      "email",
      "token",
      "invited_by",
      "expires_at",
      "accepted_at",
      "created_at",
    ])
    .executeTakeFirstOrThrow();

  // Send invitation email (fire and forget, don't block on email delivery)
  sendInvitationEmail(updated.email, newToken, company.name, resenderEmail)
    .then((result) => {
      if (!result.success) {
        logger.warn(
          { email: updated.email, error: result.error },
          "Failed to send invitation email on resend",
        );
      }
    })
    .catch((err) => {
      logger.error(
        { email: updated.email, error: err },
        "Error sending invitation email on resend",
      );
    });

  return updated as unknown as Invitation;
}
