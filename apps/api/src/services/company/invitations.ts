/**
 * Company invitation operations
 *
 * Operations for managing company invitations: create, list, accept, cancel, resend.
 */

import { db } from "@whatsapp-web/database";
import { addDays, toDbDate } from "@whatsapp-web/shared";
import { randomBytes } from "crypto";
import { sql } from "kysely";
import { sendInvitationEmail } from "../../lib/email.js";
import {
  InvitationExpiredError,
  InvitationNotFoundError,
  UserAlreadyMemberError,
} from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { getCompany } from "./core.js";
import type {
  AcceptInvitationResult,
  CompanyMember,
  Invitation,
  InvitationPreview,
  InviteMemberInput,
} from "./types.js";

const logger = createLogger("CompanyInvitations");

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
    .where("expires_at", ">", toDbDate())
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
  const expiresAt = addDays(toDbDate(), 7).toDate();

  const invitation = await db
    .insertInto("invitations")
    .values({
      company_id: companyId,
      email: input.email,
      token,
      invited_by: invitedBy,
      expires_at: expiresAt,
      created_at: toDbDate(),
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
    .where("expires_at", ">", toDbDate())
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
): Promise<AcceptInvitationResult> {
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

  if (toDbDate(invitation.expires_at) < toDbDate()) {
    throw new InvitationExpiredError();
  }

  // Start a transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction().execute(async (trx: any) => {
    // Mark invitation as accepted
    await trx
      .updateTable("invitations")
      .set({ accepted_at: toDbDate() })
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

    // Update company stats
    await trx
      .updateTable("company_stats")
      .set({
        active_users: sql`active_users + 1`,
        updated_at: toDbDate(),
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
  const expiresAt = addDays(toDbDate(), 7).toDate();

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
