import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getRouteContext } from "../../middleware/context.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { requireConversationVisibility } from "../../middleware/resource-visibility.js";
import { getClientIp } from "../../services/audit.service.js";
import {
  acknowledgeFirstChat,
  needsFirstChatAcknowledgment,
  FIRST_CHAT_NOTICE,
  FIRST_CHAT_NOTICE_URL,
  FIRST_CHAT_NOTICE_VERSION,
} from "../../services/first-chat-acknowledgment.service.js";

export const firstChatAcknowledgmentSchema = z.object({
  checked: z.literal(true),
  noticeVersion: z.literal(FIRST_CHAT_NOTICE_VERSION),
});
export const firstChatAcknowledgmentRoutes = new Hono();
const path = "/:id/first-chat-acknowledgment";
// A channel thread is addressed by conversation id and may have no contact,
// so visibility is resolved the way every other conversation route resolves it.
firstChatAcknowledgmentRoutes.use(path, requireConversationVisibility());
firstChatAcknowledgmentRoutes.get(path, async (c) => {
  const { tenantDb } = getRouteContext(c);
  return c.json({
    required: await needsFirstChatAcknowledgment(tenantDb, c.req.param("id")!),
    notice: FIRST_CHAT_NOTICE,
    noticeVersion: FIRST_CHAT_NOTICE_VERSION,
    guidanceUrl: FIRST_CHAT_NOTICE_URL,
  });
});
firstChatAcknowledgmentRoutes.post(
  path,
  requireMessageSendPermission,
  zValidator("json", firstChatAcknowledgmentSchema),
  async (c) => {
    const { tenantDb, user } = getRouteContext(c);
    await acknowledgeFirstChat(
      tenantDb,
      c.req.param("id")!,
      user.id,
      getClientIp(c),
    );
    return c.json({ success: true });
  },
);
