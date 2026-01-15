import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createLogger, formatError } from "../../lib/logger.js";
import { validatePasswordStrength } from "../../lib/password.js";
import {
  createdWithMessage,
  successWithMessage,
  validationError,
} from "../../lib/response.js";
import { registerSchema, verifyEmailSchema } from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { register, verifyEmail } from "../../services/auth.service.js";
import { registerRateLimiter } from "./rate-limiters.js";
import { handleAuthError } from "./utils.js";

const logger = createLogger("AuthRoutes:Register");

export const registerRoutes = new Hono();

/**
 * POST /register
 * Register a new user with email and password
 * Rate limit: 3 attempts per hour per IP
 */
registerRoutes.post(
  "/register",
  registerRateLimiter,
  zValidator("json", registerSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");

      // Additional password strength validation
      const passwordCheck = validatePasswordStrength(body.password);
      if (!passwordCheck.isValid) {
        return validationError(c, [
          { field: "password", message: passwordCheck.message },
        ]);
      }

      const { user } = await register(body.email, body.password, body.name);

      return createdWithMessage(
        c,
        "Registration successful. Please check your email to verify your account.",
        {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            emailVerified: !!user.emailVerifiedAt,
            createdAt: user.createdAt,
          },
        },
      );
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Registration error",
      );
    }
  },
);

/**
 * POST /verify-email
 * Verify email with token
 */
registerRoutes.post(
  "/verify-email",
  authMiddleware,
  zValidator("json", verifyEmailSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const user = c.get("user");
      const updatedUser = await verifyEmail(user.id, body.token);

      return successWithMessage(c, "Email verified successfully", {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          emailVerified: !!updatedUser.emailVerifiedAt,
        },
      });
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Email verification error",
      );
    }
  },
);
