import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createLogger, formatError } from "../../lib/logger.js";
import { validatePasswordStrength } from "../../lib/password.js";
import {
  createdWithMessage,
  successWithMessage,
  validationError,
} from "../../lib/response.js";
import {
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from "../../lib/schemas/index.js";
import {
  register,
  resendVerification,
  toAuthUserResponse,
  verifyEmail,
} from "../../services/auth.service.js";
import {
  registerRateLimiter,
  resendVerificationRateLimiter,
} from "./rate-limiters.js";
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

      const { user, verificationEmailSent } = await register(
        body.email,
        body.password,
        body.name,
      );
      const publicUser = await toAuthUserResponse(user);

      return createdWithMessage(
        c,
        verificationEmailSent
          ? "Registration successful. Please check your email to verify your account."
          : "Registration successful, but we could not send the verification email. Please retry from the sign-in page.",
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
          verificationEmailSent,
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
 * POST /resend-verification
 * Reissue a verification link after checking the account password.
 */
registerRoutes.post(
  "/resend-verification",
  resendVerificationRateLimiter,
  zValidator("json", resendVerificationSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const result = await resendVerification(body.email, body.password);
      return successWithMessage(
        c,
        result.alreadyVerified
          ? "Your email is already verified. You can sign in."
          : "A new verification email has been sent.",
        result,
      );
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Verification resend error",
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
