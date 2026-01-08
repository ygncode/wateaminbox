/**
 * Company invitation routes
 *
 * Handles invitation listing, creation, cancellation, acceptance, and resending.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam, requirePermission } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import { PERMISSIONS } from "../../services/permission.service.js";

const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

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
      token: inv.token,
      invitedBy: inv.invited_by,
      expiresAt: inv.expires_at,
      createdAt: inv.created_at,
    }));
    return c.json({
      success: true,
      data: transformedInvitations,
    });
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
    const input = c.req.valid("json") as z.infer<typeof inviteMemberSchema>;

    try {
      const invitation = await companyService.inviteMember(
        companyId,
        { email: input.email, role: input.role },
        user.id,
      );
      return c.json(
        {
          success: true,
          data: invitation,
          message: `Invitation sent to ${input.email}`,
        },
        201,
      );
    } catch (error) {
      if (error instanceof companyService.UserAlreadyMemberError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
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

    try {
      await companyService.cancelInvitation(companyId, invitationId);
      return c.json({
        success: true,
        message: "Invitation cancelled successfully",
      });
    } catch (error) {
      if (error instanceof companyService.InvitationNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
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

    try {
      const invitation = await companyService.resendInvitation(
        companyId,
        invitationId,
        user.id,
      );
      return c.json({
        success: true,
        data: invitation,
        message: `Invitation resent to ${invitation.email}`,
      });
    } catch (error) {
      if (error instanceof companyService.InvitationNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
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

  try {
    const result = await companyService.acceptInvitation(token, user.id);
    return c.json({
      success: true,
      data: {
        company: result.company,
        member: result.member,
      },
      message: `Successfully joined ${result.company.name}`,
    });
  } catch (error) {
    if (error instanceof companyService.InvitationNotFoundError) {
      throw new HTTPException(404, { message: error.message });
    }
    if (error instanceof companyService.InvitationExpiredError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
});

/**
 * GET /:token - Get invitation details (for preview before accepting)
 */
tokenInvitationRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");

  try {
    const invitation = await companyService.getInvitationByToken(token);
    return c.json({
      success: true,
      data: invitation,
    });
  } catch (error) {
    if (error instanceof companyService.InvitationNotFoundError) {
      throw new HTTPException(404, { message: error.message });
    }
    if (error instanceof companyService.InvitationExpiredError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
});
