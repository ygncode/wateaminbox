import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth.js";
import { tenantFromParam, requirePermission } from "../middleware/tenant.js";
import * as companyService from "../services/company.service.js";
import {
  PERMISSIONS,
  ROLE_PRESETS,
  getEffectivePermissions,
  updateMemberPermissions,
  resetMemberPermissions,
  getPermissionDescriptions,
} from "../services/permission.service.js";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("CompanyRoutes");

// Validation schemas
const createCompanySchema = z.object({
  name: z
    .string()
    .min(1, "Company name is required")
    .max(255, "Company name must be less than 255 characters")
    .trim(),
});

const updateCompanySchema = z.object({
  name: z
    .string()
    .min(1, "Company name is required")
    .max(255, "Company name must be less than 255 characters")
    .trim()
    .optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

const updateMemberPermissionsSchema = z.object({
  can_view_all_chats: z.boolean().optional(),
  can_send_messages: z.boolean().optional(),
  can_assign_contacts: z.boolean().optional(),
  can_manage_team: z.boolean().optional(),
  can_invite: z.boolean().optional(),
  can_export: z.boolean().optional(),
  can_delete: z.boolean().optional(),
});

// Create the router
export const companyRoutes = new Hono();

/**
 * GET /companies - List companies the user belongs to
 */
companyRoutes.get("/", authMiddleware, async (c) => {
  const user = c.get("user");

  try {
    const companies = await companyService.getUserCompanies(user.id);
    return c.json({
      success: true,
      data: companies,
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Failed to get user companies");
    throw new HTTPException(500, {
      message: "Failed to get companies",
    });
  }
});

/**
 * POST /companies - Create a new company
 */
companyRoutes.post(
  "/",
  authMiddleware,
  zValidator("json", createCompanySchema),
  async (c) => {
    const user = c.get("user");
    const input = c.req.valid("json") as z.infer<typeof createCompanySchema>;

    try {
      const company = await companyService.createCompany(
        { name: input.name },
        user.id,
      );
      return c.json(
        {
          success: true,
          data: company,
        },
        201,
      );
    } catch (error) {
      logger.error({ err: formatError(error) }, "Failed to create company");
      throw new HTTPException(500, {
        message: "Failed to create company",
      });
    }
  },
);

/**
 * GET /companies/:id - Get company details
 */
companyRoutes.get("/:id", authMiddleware, tenantFromParam("id"), async (c) => {
  const companyId = c.get("companyId");
  const role = c.get("companyRole");

  try {
    const company = await companyService.getCompany(companyId);
    return c.json({
      success: true,
      data: {
        ...company,
        role, // Include user's role in response
      },
    });
  } catch (error) {
    if (error instanceof companyService.CompanyNotFoundError) {
      throw new HTTPException(404, { message: error.message });
    }
    throw error;
  }
});

/**
 * PATCH /companies/:id - Update company
 * Requires admin role
 */
companyRoutes.patch(
  "/:id",
  authMiddleware,
  tenantFromParam("id", "admin"),
  zValidator("json", updateCompanySchema),
  async (c) => {
    const companyId = c.get("companyId");
    const input = c.req.valid("json");

    // Only owner can change status
    if (input.status !== undefined) {
      const role = c.get("companyRole");
      if (role !== "owner") {
        throw new HTTPException(403, {
          message: "Only the owner can change company status",
        });
      }
    }

    try {
      const company = await companyService.updateCompany(companyId, input);
      return c.json({
        success: true,
        data: company,
      });
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * DELETE /companies/:id - Delete company (soft delete)
 * Requires owner role
 */
companyRoutes.delete(
  "/:id",
  authMiddleware,
  tenantFromParam("id", "owner"),
  async (c) => {
    const companyId = c.get("companyId");

    try {
      await companyService.deleteCompany(companyId);
      return c.json({
        success: true,
        message: "Company deleted successfully",
      });
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * GET /companies/:id/members - List company members
 */
companyRoutes.get(
  "/:id/members",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    const companyId = c.get("companyId");

    try {
      const members = await companyService.getMembers(companyId);
      // Add effective permissions to each member
      const membersWithPermissions = members.map((member) => ({
        ...member,
        effectivePermissions: getEffectivePermissions(
          member.role,
          member.permissions as Record<string, boolean>,
        ),
      }));
      return c.json({
        success: true,
        data: membersWithPermissions,
      });
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * PATCH /companies/:id/members/:userId - Update member role
 * Requires admin role
 */
companyRoutes.patch(
  "/:id/members/:userId",
  authMiddleware,
  tenantFromParam("id", "admin"),
  zValidator("json", updateMemberRoleSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.req.param("userId");
    const { role } = c.req.valid("json");

    try {
      const member = await companyService.updateMemberRole(
        companyId,
        userId,
        role,
      );
      return c.json({
        success: true,
        data: member,
      });
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof companyService.InsufficientPermissionsError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * DELETE /companies/:id/members/:userId - Remove member from company
 * Requires admin role
 */
companyRoutes.delete(
  "/:id/members/:userId",
  authMiddleware,
  tenantFromParam("id", "admin"),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.req.param("userId");

    // Prevent self-removal
    const currentUser = c.get("user");
    if (currentUser.id === userId) {
      throw new HTTPException(400, {
        message: "You cannot remove yourself from the company",
      });
    }

    try {
      await companyService.removeMember(companyId, userId);
      return c.json({
        success: true,
        message: "Member removed successfully",
      });
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof companyService.InsufficientPermissionsError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * GET /companies/:id/invitations - List pending invitations
 * Requires can_invite permission
 */
companyRoutes.get(
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
 * POST /companies/:id/invitations - Create invitation
 * Requires can_invite permission
 */
companyRoutes.post(
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
 * DELETE /companies/:id/invitations/:invitationId - Cancel invitation
 * Requires can_invite permission
 */
companyRoutes.delete(
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

// Separate router for invitation acceptance (doesn't require tenant context)
export const invitationRoutes = new Hono();

/**
 * POST /invitations/:token/accept - Accept invitation
 */
invitationRoutes.post("/:token/accept", authMiddleware, async (c) => {
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
 * GET /invitations/:token - Get invitation details (for preview before accepting)
 */
invitationRoutes.get("/:token", async (c) => {
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

/**
 * POST /companies/:id/invitations/:invitationId/resend - Resend invitation
 * Requires can_invite permission
 */
companyRoutes.post(
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

/**
 * GET /companies/:id/permissions - List all available permissions
 */
companyRoutes.get(
  "/:id/permissions",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    return c.json({
      success: true,
      data: {
        permissions: getPermissionDescriptions(),
        rolePresets: ROLE_PRESETS,
      },
    });
  },
);

/**
 * GET /companies/:id/members/:userId/permissions - Get member's effective permissions
 */
companyRoutes.get(
  "/:id/members/:userId/permissions",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_MANAGE_TEAM),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.req.param("userId");

    try {
      const members = await companyService.getMembers(companyId);
      const member = members.find((m) => m.user_id === userId);

      if (!member) {
        throw new HTTPException(404, { message: "Member not found" });
      }

      const effectivePermissions = getEffectivePermissions(
        member.role,
        member.permissions as Record<string, boolean>,
      );

      return c.json({
        success: true,
        data: {
          role: member.role,
          customPermissions: member.permissions,
          effectivePermissions,
        },
      });
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * PATCH /companies/:id/members/:userId/permissions - Update member's custom permissions
 * Requires owner role (only owner can modify permissions)
 */
companyRoutes.patch(
  "/:id/members/:userId/permissions",
  authMiddleware,
  tenantFromParam("id", "owner"),
  zValidator("json", updateMemberPermissionsSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.req.param("userId");
    const newPermissions = c.req.valid("json");

    try {
      const effectivePermissions = await updateMemberPermissions(
        companyId,
        userId,
        newPermissions,
      );
      return c.json({
        success: true,
        data: {
          effectivePermissions,
        },
        message: "Permissions updated successfully",
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Member not found") {
          throw new HTTPException(404, { message: error.message });
        }
        if (error.message === "Cannot modify owner's permissions") {
          throw new HTTPException(403, { message: error.message });
        }
      }
      throw error;
    }
  },
);

/**
 * POST /companies/:id/members/:userId/permissions/reset - Reset member's permissions to role defaults
 * Requires owner role
 */
companyRoutes.post(
  "/:id/members/:userId/permissions/reset",
  authMiddleware,
  tenantFromParam("id", "owner"),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.req.param("userId");

    try {
      const effectivePermissions = await resetMemberPermissions(
        companyId,
        userId,
      );
      return c.json({
        success: true,
        data: {
          effectivePermissions,
        },
        message: "Permissions reset to role defaults",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Member not found") {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);
