/**
 * Company invitation operations
 *
 * Operations for managing company invitations: create, list, accept, cancel, resend.
 */

import { type Database, db } from "@wateaminbox/database";
import {
  addDays,
  type CompanyMemberRole,
  type MemberPermissions,
  toDbDate,
} from "@wateaminbox/shared";
import { randomBytes } from "crypto";
import { sql, type Transaction } from "kysely";
import { sendInvitationEmail } from "../../lib/email.js";
import {
  CompanyNotFoundError,
  InsufficientPermissionsError,
  InvitationDeliveryError,
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationNotFoundError,
  UserAlreadyMemberError,
} from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { createAuditLog } from "../audit.service.js";
import { invalidateCompanyMembership } from "../company-membership.service.js";
import {
  getEffectivePermissions,
  getMemberWithPermissions,
  ROLE_PRESETS,
} from "../permission.service.js";
import { getCompany } from "./core.js";
import type {
  AcceptInvitationResult,
  CompanyMember,
  Invitation,
  InvitationPreview,
  InviteMemberInput,
} from "./types.js";

const logger = createLogger("CompanyInvitations");

type InvitationEmailSender = typeof sendInvitationEmail;

const roleRank: Record<CompanyMemberRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** Invitations may create only roles at or below the inviter's own rank. */
export function canInviteRole(
  inviterRole: CompanyMemberRole,
  invitedRole: Exclude<CompanyMemberRole, "owner">,
): boolean {
  return roleRank[inviterRole] >= roleRank[invitedRole];
}

/** Store only permission values that differ from the selected role preset. */
export function normalizeInvitationPermissions(
  role: "admin" | "member",
  requested: Partial<MemberPermissions> = {},
): Partial<MemberPermissions> {
  const overrides: Partial<MemberPermissions> = {};
  for (const key of Object.keys(requested) as Array<keyof MemberPermissions>) {
    const value = requested[key];
    if (value !== undefined && value !== ROLE_PRESETS[role][key]) {
      overrides[key] = value;
    }
  }
  return overrides;
}

async function authorizeInvitation(
  companyId: string,
  inviterId: string,
  role: "admin" | "member",
  requestedPermissions?: Partial<MemberPermissions>,
): Promise<Partial<MemberPermissions>> {
  const inviter = await getMemberWithPermissions(companyId, inviterId);
  if (!inviter?.permissions.can_invite) {
    throw new InsufficientPermissionsError("invite workspace members");
  }
  if (!canInviteRole(inviter.role, role)) {
    throw new InsufficientPermissionsError(
      `invite a ${role} from the ${inviter.role} role`,
    );
  }
  if (
    requestedPermissions &&
    Object.keys(requestedPermissions).length > 0 &&
    inviter.role !== "owner"
  ) {
    throw new InsufficientPermissionsError(
      "customize permissions on an invitation",
    );
  }
  return normalizeInvitationPermissions(role, requestedPermissions);
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitationEmailMatches(
  invitationEmail: string,
  userEmail: string,
): boolean {
  return (
    normalizeInvitationEmail(invitationEmail) ===
    normalizeInvitationEmail(userEmail)
  );
}

/**
 * Creates an invitation to join a company
 */
export async function inviteMember(
  companyId: string,
  input: InviteMemberInput,
  invitedBy: string,
  emailSender: InvitationEmailSender = sendInvitationEmail,
): Promise<Invitation> {
  const company = await getCompany(companyId);
  const email = normalizeInvitationEmail(input.email);
  const role = input.role ?? "member";
  const permissions = await authorizeInvitation(
    companyId,
    invitedBy,
    role,
    input.permissions,
  );

  const inviter = await db
    .selectFrom("users")
    .select(["email"])
    .where("id", "=", invitedBy)
    .executeTakeFirst();
  const inviterEmail = inviter?.email || "A team member";

  const existingUser = await db
    .selectFrom("users as u")
    .innerJoin("company_members as cm", "cm.user_id", "u.id")
    .where(sql`lower(u.email)`, "=", email)
    .where("cm.company_id", "=", companyId)
    .executeTakeFirst();
  if (existingUser) throw new UserAlreadyMemberError(email);

  // Keep an existing valid invitation until replacement delivery succeeds.
  const existingInvitation = await db
    .selectFrom("invitations")
    .select(["id"])
    .where("company_id", "=", companyId)
    .where(sql`lower(email)`, "=", email)
    .where("accepted_at", "is", null)
    .where("expires_at", ">", toDbDate())
    .executeTakeFirst();

  const token = randomBytes(32).toString("hex");
  const expiresAt = addDays(toDbDate(), 7).toDate();
  const invitation = await db
    .insertInto("invitations")
    .values({
      company_id: companyId,
      email,
      role,
      permissions,
      token,
      invited_by: invitedBy,
      expires_at: expiresAt,
      created_at: toDbDate(),
    })
    .returning([
      "id",
      "company_id",
      "email",
      "role",
      "permissions",
      "token",
      "invited_by",
      "expires_at",
      "accepted_at",
      "created_at",
    ])
    .executeTakeFirstOrThrow();

  let deliveryError: string | undefined;
  try {
    const delivery = await emailSender(
      email,
      token,
      company.name,
      inviterEmail,
    );
    if (!delivery.success) deliveryError = delivery.error || "Unknown error";
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : "Unknown error";
  }

  if (deliveryError) {
    await db
      .deleteFrom("invitations")
      .where("id", "=", invitation.id)
      .execute();
    logger.warn(
      { email, error: deliveryError },
      "Invitation was rolled back because email delivery failed",
    );
    throw new InvitationDeliveryError(email);
  }

  if (existingInvitation) {
    await db
      .deleteFrom("invitations")
      .where("id", "=", existingInvitation.id)
      .execute();
  }

  return invitation as unknown as Invitation;
}

/**
 * Gets pending invitations for a company
 */
export async function getPendingInvitations(
  companyId: string,
): Promise<Invitation[]> {
  const invitations = await db
    .selectFrom("invitations as i")
    .innerJoin("users as inviter", "inviter.id", "i.invited_by")
    .select([
      "i.id",
      "i.company_id",
      "i.email",
      "i.role",
      "i.permissions",
      "i.token",
      "i.invited_by",
      "inviter.name as inviter_name",
      "inviter.email as inviter_email",
      "i.expires_at",
      "i.accepted_at",
      "i.created_at",
    ])
    .where("i.company_id", "=", companyId)
    .where("i.accepted_at", "is", null)
    .where("i.expires_at", ">", toDbDate())
    .execute();

  return invitations as unknown as Invitation[];
}

export interface ListPendingInvitationsOptions {
  search?: string;
  role?: "all" | "admin" | "member";
  limit: number;
  offset: number;
}

/**
 * Lists pending invitations for the dashboard table with database-backed
 * filtering and pagination.
 */
export async function listPendingInvitations(
  companyId: string,
  options: ListPendingInvitationsOptions,
): Promise<{ invitations: Invitation[]; total: number }> {
  const search = options.search?.trim();
  const searchPattern = search ? `%${search}%` : null;
  const role =
    options.role && options.role !== "all" ? options.role : undefined;
  const currentDate = toDbDate();

  let invitationsQuery = db
    .selectFrom("invitations as i")
    .innerJoin("users as inviter", "inviter.id", "i.invited_by")
    .select([
      "i.id",
      "i.company_id",
      "i.email",
      "i.role",
      "i.permissions",
      "i.token",
      "i.invited_by",
      "inviter.name as inviter_name",
      "inviter.email as inviter_email",
      "i.expires_at",
      "i.accepted_at",
      "i.created_at",
    ])
    .where("i.company_id", "=", companyId)
    .where("i.accepted_at", "is", null)
    .where("i.expires_at", ">", currentDate);

  let countQuery = db
    .selectFrom("invitations as i")
    .innerJoin("users as inviter", "inviter.id", "i.invited_by")
    .select((expression) => expression.fn.countAll<number>().as("count"))
    .where("i.company_id", "=", companyId)
    .where("i.accepted_at", "is", null)
    .where("i.expires_at", ">", currentDate);

  if (searchPattern) {
    invitationsQuery = invitationsQuery.where((expression) =>
      expression.or([
        expression("i.email", "ilike", searchPattern),
        expression("inviter.name", "ilike", searchPattern),
        expression("inviter.email", "ilike", searchPattern),
      ]),
    );
    countQuery = countQuery.where((expression) =>
      expression.or([
        expression("i.email", "ilike", searchPattern),
        expression("inviter.name", "ilike", searchPattern),
        expression("inviter.email", "ilike", searchPattern),
      ]),
    );
  }

  if (role) {
    invitationsQuery = invitationsQuery.where("i.role", "=", role);
    countQuery = countQuery.where("i.role", "=", role);
  }

  const [invitations, countResult] = await Promise.all([
    invitationsQuery
      .orderBy("i.created_at", "desc")
      .limit(options.limit)
      .offset(options.offset)
      .execute(),
    countQuery.executeTakeFirstOrThrow(),
  ]);

  return {
    invitations: invitations as unknown as Invitation[],
    total: Number(countResult.count),
  };
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

export interface InvitationAcceptanceContext {
  ipAddress?: string;
}

/**
 * Applies an invitation inside a caller-owned transaction. Email verification
 * uses this so verification and membership creation either both commit or both
 * roll back.
 */
export async function acceptInvitationInTransaction(
  trx: Transaction<Database>,
  token: string,
  userId: string,
): Promise<AcceptInvitationResult> {
  const invitation = await trx
    .selectFrom("invitations")
    .select([
      "id",
      "company_id",
      "email",
      "role",
      "permissions",
      "invited_by",
      "expires_at",
    ])
    .where("token", "=", token)
    .where("accepted_at", "is", null)
    .executeTakeFirst();

  if (!invitation) throw new InvitationNotFoundError(token);
  if (toDbDate(invitation.expires_at) < toDbDate()) {
    throw new InvitationExpiredError();
  }

  const recipient = await trx
    .selectFrom("users")
    .select("email")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (
    !recipient ||
    !invitationEmailMatches(invitation.email, recipient.email)
  ) {
    throw new InvitationEmailMismatchError();
  }

  const existingMembership = await trx
    .selectFrom("company_members")
    .select("id")
    .where("company_id", "=", invitation.company_id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (existingMembership) throw new UserAlreadyMemberError(recipient.email);

  const company = await trx
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
    .where("id", "=", invitation.company_id)
    .where("status", "!=", "deleted")
    .executeTakeFirst();
  if (!company) throw new CompanyNotFoundError(invitation.company_id);

  // Atomically claim the invitation so concurrent acceptance cannot add
  // duplicate memberships or increment company statistics twice.
  const claimedInvitation = await trx
    .updateTable("invitations")
    .set({ accepted_at: toDbDate() })
    .where("id", "=", invitation.id)
    .where("accepted_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  if (!claimedInvitation) throw new InvitationNotFoundError(token);

  const member = await trx
    .insertInto("company_members")
    .values({
      user_id: userId,
      company_id: invitation.company_id,
      role: invitation.role,
      permissions: invitation.permissions,
      invited_by: invitation.invited_by,
      joined_at: toDbDate(),
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

  await trx
    .updateTable("company_stats")
    .set({
      active_users: sql`active_users + 1`,
      updated_at: toDbDate(),
    })
    .where("company_id", "=", invitation.company_id)
    .execute();

  return {
    company: company as unknown as AcceptInvitationResult["company"],
    member: member as unknown as CompanyMember,
  };
}

/** Runs post-commit cache invalidation and security audit recording. */
export async function completeInvitationAcceptance(
  result: AcceptInvitationResult,
  userId: string,
  context: InvitationAcceptanceContext = {},
): Promise<void> {
  invalidateCompanyMembership(result.company.id);
  await createAuditLog({
    companyId: result.company.id,
    userId,
    action: "invitation.accepted",
    entityType: "member",
    entityId: result.member.id,
    details: {
      role: result.member.role,
      accessMode:
        Object.keys(result.member.permissions).length > 0
          ? "custom"
          : "role_defaults",
      permissionOverrides: result.member.permissions,
    },
    ipAddress: context.ipAddress,
  });
}

/** Accepts an invitation using a token. */
export async function acceptInvitation(
  token: string,
  userId: string,
  context: InvitationAcceptanceContext = {},
): Promise<AcceptInvitationResult> {
  const result = await db
    .transaction()
    .execute((trx) => acceptInvitationInTransaction(trx, token, userId));
  await completeInvitationAcceptance(result, userId, context);
  return result;
}

/**
 * Gets invitation by token (for preview before accepting)
 */
export async function getInvitationByToken(
  token: string,
): Promise<InvitationPreview> {
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
      "i.role",
      "i.permissions",
    ])
    .where("i.token", "=", token)
    .where("c.status", "!=", "deleted")
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
    role: result.role,
    permissions: result.permissions as Partial<MemberPermissions>,
    effectivePermissions: getEffectivePermissions(
      result.role,
      result.permissions as Partial<MemberPermissions>,
    ),
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
  emailSender: InvitationEmailSender = sendInvitationEmail,
): Promise<Invitation> {
  const company = await getCompany(companyId);
  const resender = await db
    .selectFrom("users")
    .select(["email"])
    .where("id", "=", userId)
    .executeTakeFirst();
  const resenderEmail = resender?.email || "A team member";

  const invitation = await db
    .selectFrom("invitations")
    .select([
      "id",
      "company_id",
      "email",
      "role",
      "permissions",
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
  if (!invitation) throw new InvitationNotFoundError(invitationId);
  await authorizeInvitation(companyId, userId, invitation.role);

  const newToken = randomBytes(32).toString("hex");
  const expiresAt = addDays(toDbDate(), 7).toDate();
  const updated = await db
    .updateTable("invitations")
    .set({ token: newToken, expires_at: expiresAt, invited_by: userId })
    .where("id", "=", invitationId)
    .returning([
      "id",
      "company_id",
      "email",
      "role",
      "permissions",
      "token",
      "invited_by",
      "expires_at",
      "accepted_at",
      "created_at",
    ])
    .executeTakeFirstOrThrow();

  let deliveryError: string | undefined;
  try {
    const delivery = await emailSender(
      updated.email,
      newToken,
      company.name,
      resenderEmail,
    );
    if (!delivery.success) deliveryError = delivery.error || "Unknown error";
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : "Unknown error";
  }

  if (deliveryError) {
    // Preserve the previously valid invitation when a resend cannot be delivered.
    await db
      .updateTable("invitations")
      .set({
        token: invitation.token,
        expires_at: invitation.expires_at,
        invited_by: invitation.invited_by,
      })
      .where("id", "=", invitationId)
      .where("token", "=", newToken)
      .execute();
    logger.warn(
      { email: invitation.email, error: deliveryError },
      "Invitation resend was rolled back because email delivery failed",
    );
    throw new InvitationDeliveryError(invitation.email);
  }

  return updated as unknown as Invitation;
}
