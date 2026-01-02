import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth.js";
import { tenantFromParam } from "../middleware/tenant.js";
import * as companyService from "../services/company.service.js";

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
    console.error("Failed to get user companies:", error);
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
      console.error("Failed to create company:", error);
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
      return c.json({
        success: true,
        data: members,
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
 * Requires admin role
 */
companyRoutes.get(
  "/:id/invitations",
  authMiddleware,
  tenantFromParam("id", "admin"),
  async (c) => {
    const companyId = c.get("companyId");

    const invitations = await companyService.getPendingInvitations(companyId);
    return c.json({
      success: true,
      data: invitations,
    });
  },
);

/**
 * POST /companies/:id/invitations - Create invitation
 * Requires admin role
 */
companyRoutes.post(
  "/:id/invitations",
  authMiddleware,
  tenantFromParam("id", "admin"),
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
 * Requires admin role
 */
companyRoutes.delete(
  "/:id/invitations/:invitationId",
  authMiddleware,
  tenantFromParam("id", "admin"),
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
 * Requires admin role
 */
companyRoutes.post(
  "/:id/invitations/:invitationId/resend",
  authMiddleware,
  tenantFromParam("id", "admin"),
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
