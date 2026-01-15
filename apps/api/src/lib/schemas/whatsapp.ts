import { z } from "zod";

/**
 * Schema for sending a WhatsApp message
 */
export const sendMessageSchema = z.object({
  jid: z
    .string()
    .min(1, "JID is required")
    .regex(
      /^[0-9]+@(s\.whatsapp\.net|g\.us)$/,
      "Invalid JID format. Expected format: number@s.whatsapp.net or groupid@g.us",
    ),
  content: z.string().min(1, "Message content is required"),
  messageType: z
    .enum(["text", "image", "video", "audio", "document", "sticker"])
    .default("text"),
  mediaUrl: z.string().url().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
