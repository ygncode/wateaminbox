/**
 * Company member routes
 *
 * Handles member listing, role updates, and member removal.
 */

import { zValidator } from "@hono/zod-validator";
import type { CompanyMember } from "@wateaminbox/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createPaginationMeta } from "../../lib/route-helpers.js";
import {
  successData,
  successMessage,
  successPaginated,
} from "../../lib/response.js";
import {
  listCompanyMembersQuerySchema,
  updateMemberRoleSchema,
} from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission, tenantFromParam } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import {
  getEffectivePermissions,
  PERMISSIONS,
} from "../../services/permission.service.js";
import { getUserAvatarSources } from "../../services/user.service.js";

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
    name: member.name || undefined,
    email: member.email || "",
  };
}

export const memberRoutes = new Hono();

/**
 * GET /:id/member-identities
 * Minimal teammate identity directory used by shared-inbox message attribution.
 * Every active workspace member may read it; emails, roles, and permissions are
 * intentionally excluded.
 */
memberRoutes.get(
  "/:id/member-identities",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    const companyId = c.get("companyId");
    const members = await companyService.getMembers(companyId);
    const avatarSources = await getUserAvatarSources(
      members.map((member) => member.user_id),
    );

    return successData(
      c,
      members.map((member) => {
        const avatars = avatarSources.get(member.user_id);
        return {
          userId: member.user_id,
          name: member.name || member.email?.split("@")[0] || "Team member",
          avatarUrl: avatars?.avatarUrl || null,
          gravatarUrl: avatars?.gravatarUrl || null,
        };
      }),
    );
  },
);

/**
 * GET /:id/members - List company members
 * Query params: search, role, limit, offset
 */
memberRoutes.get(
  "/:id/members",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_MANAGE_TEAM),
  zValidator("query", listCompanyMembersQuerySchema),
  async (c) => {
    const companyId = c.get("companyId");
    const { search, role, limit, offset } = c.req.valid("query");

    try {
      const result = await companyService.listMembers(companyId, {
        search,
        role,
        limit,
        offset,
      });
      // Transform to API format and add effective permissions
      const membersWithPermissions = result.members.map((member) => {
        const apiMember = toApiMember(member);
        return {
          ...apiMember,
          effectivePermissions: getEffectivePermissions(
            apiMember.role,
            apiMember.permissions,
          ),
        };
      });
      return successPaginated(
        c,
        membersWithPermissions,
        createPaginationMeta(result.total, membersWithPermissions.length, {
          limit,
          offset,
        }),
      );
    } catch (error) {
      if (error instanceof companyService.CompanyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

/** POST /:id/transfer-ownership - Transfer ownership to another member. */
memberRoutes.post(
  "/:id/transfer-ownership",
  authMiddleware,
  tenantFromParam("id", "owner"),
  zValidator("json", z.object({ userId: z.string().uuid() })),
  async (c) => {
    const companyId = c.get("companyId");
    const currentUser = c.get("user");
    const { userId } = c.req.valid("json");
    try {
      await companyService.transferOwnership(companyId, currentUser.id, userId);
      return successMessage(c, "Workspace ownership transferred successfully");
    } catch (error) {
      if (error instanceof companyService.InsufficientPermissionsError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  },
);

/** POST /:id/leave - Leave a workspace as a non-owner member. */
memberRoutes.post(
  "/:id/leave",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    const companyId = c.get("companyId");
    const currentUser = c.get("user");
    if (c.get("companyRole") === "owner") {
      throw new HTTPException(400, {
        message: "Transfer ownership before leaving this workspace",
      });
    }
    await companyService.removeMember(companyId, currentUser.id);
    return successMessage(c, "You left the workspace successfully");
  },
);

/**
 * PATCH /:id/members/:userId - Update member role
 * Requires admin role
 */
memberRoutes.patch(
  "/:id/members/:userId",
  authMiddleware,
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_MANAGE_TEAM),
  zValidator("json", updateMemberRoleSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.req.param("userId");
    const { role } = c.req.valid("json");
    const actorRole = c.get("companyRole");

    try {
      const targetRole = await companyService.getMemberRole(companyId, userId);
      if (
        !targetRole ||
        !companyService.canManageMember(actorRole, targetRole)
      ) {
        throw new companyService.InsufficientPermissionsError(
          "change a member at or above your role",
        );
      }
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
  tenantFromParam("id"),
  requirePermission(PERMISSIONS.CAN_MANAGE_TEAM),
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
      const actorRole = c.get("companyRole");
      const targetRole = await companyService.getMemberRole(companyId, userId);
      if (
        !targetRole ||
        !companyService.canManageMember(actorRole, targetRole)
      ) {
        throw new companyService.InsufficientPermissionsError(
          "remove a member at or above your role",
        );
      }
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
