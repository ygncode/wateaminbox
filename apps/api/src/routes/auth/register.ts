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
import {
  register,
  toAuthUserResponse,
  verifyEmail,
} from "../../services/auth.service.js";
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
          {
            field: "password",
            message: passwordCheck.message ?? "Password is not strong enough",
          },
        ]);
      }

      const { user } = await register(body.email, body.password, body.name);
      const publicUser = await toAuthUserResponse(user);

      return createdWithMessage(
        c,
        "Registration successful. Please check your email to verify your account.",
        {
          user: {
            id: user.id,
            email: publicUser.email,
            name: publicUser.name,
            avatarUrl: publicUser.avatarUrl,
            gravatarUrl: publicUser.gravatarUrl,
            hasCustomAvatar: publicUser.hasCustomAvatar,
            emailVerified: publicUser.emailVerified,
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
  zValidator("json", verifyEmailSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const updatedUser = await verifyEmail(body.token);

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
