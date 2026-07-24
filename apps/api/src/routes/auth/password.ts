import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createLogger, formatError } from "../../lib/logger.js";
import { validatePasswordStrength } from "../../lib/password.js";
import { successMessage, validationError } from "../../lib/response.js";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../../lib/schemas/index.js";
import { forgotPassword, resetPassword } from "../../services/auth.service.js";
import { forgotPasswordRateLimiter } from "./rate-limiters.js";
import { handleAuthError } from "./utils.js";

const logger = createLogger("AuthRoutes:Password");

export const passwordRoutes = new Hono();

/**
 * POST /forgot-password
 * Request a password reset email
 * Rate limit: 3 attempts per hour per IP
 */
passwordRoutes.post(
  "/forgot-password",
  forgotPasswordRateLimiter,
  zValidator("json", forgotPasswordSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");

      await forgotPassword(body.email);

      // Always return success to prevent email enumeration
      return successMessage(
        c,
        "If an account exists with this email, you will receive a password reset link.",
      );
    } catch (error) {
      logger.error({ err: formatError(error) }, "Forgot password error");
      // Always return success to prevent email enumeration
      return successMessage(
        c,
        "If an account exists with this email, you will receive a password reset link.",
      );
    }
  },
);

/**
 * POST /reset-password
 * Reset password with token
 */
passwordRoutes.post(
  "/reset-password",
  zValidator("json", resetPasswordSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");

      // Additional password strength validation
      const passwordCheck = validatePasswordStrength(body.password);
      if (!passwordCheck.isValid) {
        return validationError(c, [
          {
            field: "password",
            message: passwordCheck.message ?? "Password is not strong enough",
          },
        ]);
      }

      await resetPassword(body.token, body.password);

      return successMessage(c, "Password reset successfully");
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Reset password error",
      );
    }
  },
);
