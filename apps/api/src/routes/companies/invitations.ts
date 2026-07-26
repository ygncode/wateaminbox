/**
 * Company invitation routes
 *
 * Handles invitation listing, creation, cancellation, acceptance, and resending.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  successData,
  successMessage,
  successWithMessage,
} from "../../lib/response.js";
import {
  type InviteMemberInput,
  inviteMemberSchema,
} from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission, tenantFromParam } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import { PERMISSIONS } from "../../services/permission.service.js";

export const invitationRoutes = new Hono();

/**
 * GET /:id/invitations - List pending invitations
 * Requires can_invite permission
 */
invitationRoutes.get(
  "/:id/invitations",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_INVITE),
  async (c) => {
    const companyId = c.get("companyId");

    const invitations = await companyService.getPendingInvitations(companyId);
    // Transform snake_case to camelCase for frontend
    const transformedInvitations = invitations.map((inv) => ({
      id: inv.id,
      companyId: inv.company_id,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      invitedBy: inv.invited_by,
      inviterName: inv.inviter_name,
      inviterEmail: inv.inviter_email,
      deliveryState: "delivered" as const,
      expiresAt: inv.expires_at,
      createdAt: inv.created_at,
    }));
    return successData(c, transformedInvitations);
  },
);

/**
 * POST /:id/invitations - Create invitation
 * Requires can_invite permission
 */
invitationRoutes.post(
  "/:id/invitations",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_INVITE),
  zValidator("json", inviteMemberSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const input = c.req.valid("json") as InviteMemberInput;

    const invitation = await companyService.inviteMember(
      companyId,
      { email: input.email, role: input.role },
      user.id,
    );
    return successWithMessage(
      c,
      `Invitation sent to ${input.email}`,
      { invitation },
      201,
    );
  },
);

/**
 * DELETE /:id/invitations/:invitationId - Cancel invitation
 * Requires can_invite permission
 */
invitationRoutes.delete(
  "/:id/invitations/:invitationId",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_INVITE),
  async (c) => {
    const companyId = c.get("companyId");
    const invitationId = c.req.param("invitationId");

    await companyService.cancelInvitation(companyId, invitationId);
    return successMessage(c, "Invitation cancelled successfully");
  },
);

/**
 * POST /:id/invitations/:invitationId/resend - Resend invitation
 * Requires can_invite permission
 */
invitationRoutes.post(
  "/:id/invitations/:invitationId/resend",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_INVITE),
  async (c) => {
    const companyId = c.get("companyId");
    const invitationId = c.req.param("invitationId");
    const user = c.get("user");

    const invitation = await companyService.resendInvitation(
      companyId,
      invitationId,
      user.id,
    );
    return successWithMessage(c, `Invitation resent to ${invitation.email}`, {
      invitation,
    });
  },
);

// Separate router for invitation acceptance (doesn't require tenant context)
export const tokenInvitationRoutes = new Hono();

/**
 * POST /:token/accept - Accept invitation
 */
tokenInvitationRoutes.post("/:token/accept", authMiddleware, async (c) => {
  const token = c.req.param("token");
  const user = c.get("user");

  const result = await companyService.acceptInvitation(token, user.id);
  return successWithMessage(c, `Successfully joined ${result.company.name}`, {
    company: result.company,
    member: result.member,
  });
});

/**
 * GET /:token - Get invitation details (for preview before accepting)
 */
tokenInvitationRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");

  const invitation = await companyService.getInvitationByToken(token);
  return successData(c, invitation);
});
