/**
 * Company CRUD routes
 *
 * Handles company listing, creation, reading, updating, and deletion.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import { createLogger, formatError } from "../../lib/logger.js";

const logger = createLogger("CompanyRoutes:CRUD");

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

export const crudRoutes = new Hono();

/**
 * GET / - List companies the user belongs to
 */
crudRoutes.get("/", authMiddleware, async (c) => {
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
 * POST / - Create a new company
 */
crudRoutes.post(
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
 * GET /:id - Get company details
 */
crudRoutes.get("/:id", authMiddleware, tenantFromParam("id"), async (c) => {
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
 * PATCH /:id - Update company
 * Requires admin role
 */
crudRoutes.patch(
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
 * DELETE /:id - Delete company (soft delete)
 * Requires owner role
 */
crudRoutes.delete(
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
