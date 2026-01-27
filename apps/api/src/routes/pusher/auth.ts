/**
 * Pusher Authentication Routes
 *
 * Handles Pusher private channel authentication.
 * Verifies that users can only subscribe to their company's channel.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createLogger } from "../../lib/logger.js";
import { authenticateChannel } from "../../lib/pusher.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantFromHeader } from "../../middleware/tenant.js";

const logger = createLogger("PusherAuth");

// Schema for Pusher auth request
const pusherAuthSchema = z.object({
  socket_id: z.string().min(1),
  channel_name: z.string().min(1),
});

export const pusherAuthRoutes = new Hono();

/**
 * POST /auth - Authenticate Pusher channel subscription
 *
 * Pusher sends this request when a client tries to subscribe to a private channel.
 * We verify that the user is authorized to subscribe to the requested channel.
 */
pusherAuthRoutes.post(
  "/auth",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  zValidator("form", pusherAuthSchema),
  async (c) => {
    const user = c.get("user");
    const companyId = c.get("companyId");
    const { socket_id, channel_name } = c.req.valid("form");

    logger.debug(
      { userId: user.id, companyId, channelName: channel_name, socketId: socket_id },
      "Pusher auth request",
    );

    // Validate channel name format
    // Expected format: private-company-{companyId}
    const channelMatch = channel_name.match(/^private-company-(.+)$/);

    if (!channelMatch) {
      logger.warn(
        { channelName: channel_name, userId: user.id },
        "Invalid channel name format",
      );
      throw new HTTPException(403, {
        message: "Invalid channel name format",
      });
    }

    const requestedCompanyId = channelMatch[1];

    // Verify user belongs to the requested company
    if (requestedCompanyId !== companyId) {
      logger.warn(
        {
          requestedCompanyId,
          userCompanyId: companyId,
          userId: user.id,
        },
        "User attempted to subscribe to unauthorized company channel",
      );
      throw new HTTPException(403, {
        message: "Unauthorized to subscribe to this channel",
      });
    }

    // Generate Pusher auth signature
    try {
      const authResponse = authenticateChannel(
        socket_id,
        channel_name,
        user.id,
      );

      logger.debug(
        { userId: user.id, companyId, channelName: channel_name },
        "Pusher auth successful",
      );

      return c.json(authResponse);
    } catch (error) {
      logger.error(
        { error, userId: user.id, channelName: channel_name },
        "Failed to generate Pusher auth",
      );
      throw new HTTPException(500, {
        message: "Failed to authenticate channel",
      });
    }
  },
);

export default pusherAuthRoutes;
