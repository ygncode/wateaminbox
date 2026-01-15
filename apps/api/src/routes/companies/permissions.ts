/**
 * Company permissions routes
 *
 * Handles permission listing, member permissions, and permission management.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam, requirePermission } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import {
  PERMISSIONS,
  ROLE_PRESETS,
  getEffectivePermissions,
  updateMemberPermissions,
  resetMemberPermissions,
  getPermissionDescriptions,
} from "../../services/permission.service.js";
import { successData, successWithMessage } from "../../lib/response.js";
import { updateMemberPermissionsSchema } from "../../lib/schemas/index.js";

export const permissionRoutes = new Hono();

/**
 * GET /:id/permissions - List all available permissions
 */
permissionRoutes.get(
  "/:id/permissions",
  authMiddleware,
  tenantFromParam("id"),
  async (c) => {
    return successData(c, {
      permissions: getPermissionDescriptions(),
      rolePresets: ROLE_PRESETS,
    });
  },
);

/**
 * GET /:id/members/:userId/permissions - Get member's effective permissions
 */
permissionRoutes.get(
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

      return successData(c, {
        role: member.role,
        customPermissions: member.permissions,
        effectivePermissions,
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
 * PATCH /:id/members/:userId/permissions - Update member's custom permissions
 * Requires owner role (only owner can modify permissions)
 */
permissionRoutes.patch(
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
      return successWithMessage(
        c,
        { effectivePermissions },
        "Permissions updated successfully",
      );
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
 * POST /:id/members/:userId/permissions/reset - Reset member's permissions to role defaults
 * Requires owner role
 */
permissionRoutes.post(
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
      return successWithMessage(
        c,
        { effectivePermissions },
        "Permissions reset to role defaults",
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Member not found") {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);
