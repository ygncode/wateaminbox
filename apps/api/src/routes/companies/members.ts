/**
 * Company member routes
 *
 * Handles member listing, role updates, and member removal.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import { getEffectivePermissions } from "../../services/permission.service.js";

const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

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
