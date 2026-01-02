import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth.js";
import { tenantFromHeader } from "../middleware/tenant.js";
import * as whatsappService from "../services/whatsapp.service.js";

// Validation schemas
const sendMessageSchema = z.object({
  jid: z
    .string()
    .min(1, "JID is required")
    .regex(
      /^[0-9]+@(s\.whatsapp\.net|g\.us)$/,
      "Invalid JID format. Expected format: number@s.whatsapp.net or groupid@g.us",
    ),
  content: z.string().min(1, "Message content is required"),
  messageType: z
    .enum(["text", "image", "video", "audio", "document"])
    .default("text"),
  mediaUrl: z.string().url().optional(),
});

// Create the router
export const whatsappRoutes = new Hono();

/**
 * POST /whatsapp/connect - Start WhatsApp connection flow
 * Returns a WebSocket URL for QR code streaming
 */
whatsappRoutes.post(
  "/connect",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");

    try {
      const result = await whatsappService.spawnConnection(
        tenantDb,
        companyId,
        user.id,
      );

      return c.json({
        success: true,
        data: {
          connectionId: result.connectionId,
          wsUrl: result.wsUrl,
          message:
            "Connection initiated. Connect to the WebSocket URL to receive the QR code.",
        },
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionAlreadyExistsError) {
        throw new HTTPException(409, { message: error.message });
      }
      console.error("Failed to spawn WhatsApp connection:", error);
      throw new HTTPException(500, {
        message: "Failed to initiate WhatsApp connection",
      });
    }
  },
);

/**
 * POST /whatsapp/disconnect - Disconnect WhatsApp
 */
whatsappRoutes.post(
  "/disconnect",
  authMiddleware,
  tenantFromHeader("X-Company-ID", "admin"),
  async (c) => {
    const companyId = c.get("companyId");
    const tenantDb = c.get("tenantDb");

    try {
      await whatsappService.killConnection(tenantDb, companyId);

      return c.json({
        success: true,
        message: "WhatsApp disconnection initiated",
      });
    } catch (error) {
      if (error instanceof whatsappService.ConnectionNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Failed to disconnect WhatsApp:", error);
      throw new HTTPException(500, {
        message: "Failed to disconnect WhatsApp",
      });
    }
  },
);

/**
 * GET /whatsapp/status - Get WhatsApp connection status
 */
whatsappRoutes.get(
  "/status",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const tenantDb = c.get("tenantDb");

    try {
      const status = await whatsappService.getConnectionStatus(tenantDb);

      return c.json({
        success: true,
        data: status,
      });
    } catch (error) {
      console.error("Failed to get connection status:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection status",
      });
    }
  },
);

/**
 * POST /whatsapp/send - Send a WhatsApp message
 */
whatsappRoutes.post(
  "/send",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  zValidator("json", sendMessageSchema),
  async (c) => {
    const companyId = c.get("companyId");
    const user = c.get("user");
    const tenantDb = c.get("tenantDb");
    const input = c.req.valid("json");

    // Validate that mediaUrl is provided for non-text messages
    if (input.messageType !== "text" && !input.mediaUrl) {
      throw new HTTPException(400, {
        message: `mediaUrl is required for ${input.messageType} messages`,
      });
    }

    try {
      const result = await whatsappService.sendMessage(
        tenantDb,
        companyId,
        user.id,
        {
          jid: input.jid,
          content: input.content,
          messageType: input.messageType,
          mediaUrl: input.mediaUrl,
        },
      );

      return c.json({
        success: true,
        data: {
          messageId: result.messageId,
          status: "pending",
          message: "Message queued for sending",
        },
      });
    } catch (error) {
      if (error instanceof whatsappService.InvalidConnectionStateError) {
        throw new HTTPException(400, { message: error.message });
      }
      console.error("Failed to send message:", error);
      throw new HTTPException(500, {
        message: "Failed to send message",
      });
    }
  },
);

/**
 * GET /whatsapp/connection - Get detailed connection info
 */
whatsappRoutes.get(
  "/connection",
  authMiddleware,
  tenantFromHeader("X-Company-ID"),
  async (c) => {
    const tenantDb = c.get("tenantDb");

    try {
      const connection = await whatsappService.getActiveConnection(tenantDb);

      if (!connection) {
        return c.json({
          success: true,
          data: null,
          message: "No active connection found",
        });
      }

      return c.json({
        success: true,
        data: {
          id: connection.id,
          phoneNumber: connection.phoneNumber,
          jid: connection.jid,
          status: connection.status,
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
        },
      });
    } catch (error) {
      console.error("Failed to get connection info:", error);
      throw new HTTPException(500, {
        message: "Failed to get connection information",
      });
    }
  },
);
