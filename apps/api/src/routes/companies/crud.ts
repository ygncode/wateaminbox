/**
 * Company CRUD routes
 *
 * Handles company listing, creation, reading, updating, and deletion.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { ForbiddenError } from "../../lib/errors.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromParam } from "../../middleware/tenant.js";
import * as companyService from "../../services/company.service.js";
import { created, successData, successMessage } from "../../lib/response.js";
import {
  createCompanySchema,
  updateCompanySchema,
  type CreateCompanyInput,
} from "../../lib/schemas/index.js";

export const crudRoutes = new Hono();

/**
 * GET / - List companies the user belongs to
 */
crudRoutes.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const companies = await companyService.getUserCompanies(user.id);
  return successData(c, companies);
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
    const input = c.req.valid("json") as CreateCompanyInput;
    const company = await companyService.createCompany(
      { name: input.name },
      user.id,
    );
    return created(c, company);
  },
);

/**
 * GET /:id - Get company details
 */
crudRoutes.get("/:id", authMiddleware, tenantFromParam("id"), async (c) => {
  const companyId = c.get("companyId");
  const role = c.get("companyRole");

  const company = await companyService.getCompany(companyId);
  return successData(c, {
    ...company,
    role, // Include user's role in response
  });
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
        throw new ForbiddenError("Only the owner can change company status");
      }
    }

    const company = await companyService.updateCompany(companyId, input);
    return successData(c, company);
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

    await companyService.deleteCompany(companyId);
    return successMessage(c, "Company deleted successfully");
  },
);
