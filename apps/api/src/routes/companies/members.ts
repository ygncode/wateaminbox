/**
 * Company member routes
 *
 * Handles member listing, role updates, and member removal.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import type { CompanyMember } from "@wateaminbox/shared";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import { getEffectivePermissions } from "../../services/permission.service.js";
import { successData, successMessage } from "../../lib/response.js";
import { updateMemberRoleSchema } from "../../lib/schemas/index.js";

/**
 * Transform internal member to API response format
 */
function toApiMember(
  member: companyService.CompanyMember,
): CompanyMember & { permissions: Record<string, boolean> } {
  return {
    id: member.id,
    userId: member.user_id,
    companyId: member.company_id,
    role: member.role,
    permissions: member.permissions as Record<string, boolean>,
    invitedBy: member.invited_by,
    joinedAt: member.joined_at.toISOString(),
    email: member.email || "",
  };
}

export const memberRoutes = new Hono();

/**
 * GET /:id/members - List company members
 */
memberRoutes.get(
  "/:id/members",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    const companyId = c.get("companyId");

    try {
      const members = await companyService.getMembers(companyId);
      // Transform to API format and add effective permissions
      const membersWithPermissions = members.map((member) => {
        const apiMember = toApiMember(member);
        return {
          ...apiMember,
          effectivePermissions: getEffectivePermissions(
            apiMember.role,
            apiMember.permissions,
          ),
        };
      });
      return successData(c, membersWithPermissions);
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * PATCH /:id/members/:userId - Update member role
 * Requires admin role
 */
memberRoutes.patch(
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
      // Transform to API format (email not available from update, use empty string)
      const apiMember: CompanyMember = {
        id: member.id,
        userId: member.user_id,
        companyId: member.company_id,
        role: member.role,
        invitedBy: member.invited_by,
        joinedAt: member.joined_at.toISOString(),
        email: "",
      };
      return successData(c, apiMember);
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
 * DELETE /:id/members/:userId - Remove member from company
 * Requires admin role
 */
memberRoutes.delete(
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
      return successMessage(c, "Member removed successfully");
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
