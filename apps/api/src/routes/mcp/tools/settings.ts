import { z } from "zod";
import { createSlaPolicySchema } from "../../../lib/schemas/sla-policy.js";
import {
  createQuickReplySchema,
  updateQuickReplySchema,
  updateAutoReplySettingsSchema,
} from "../../../lib/schemas/quick-replies.js";
import { getRouteContext } from "../../../middleware/context.js";
import * as sla from "../../../services/sla-policy/policy.service.js";
import * as replies from "../../../services/quick-replies.service.js";
import * as autoReply from "../../../services/auto-reply.service.js";
import { McpToolError, type McpToolDefinition } from "../tool-context.js";

// MCP accepts a raw object shape, which cannot carry object-level refinements.
// Parse the full REST schema again before invoking a service.
function validated<T extends z.ZodTypeAny>(
  schema: T,
  args: unknown,
): z.output<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new McpToolError(
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return result.data;
}

const replyId = { quickReplyId: z.string().uuid() };
const listSchema = z.object({
  search: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
const editSchema = updateQuickReplySchema.extend(replyId);

export const settingsReadTools: McpToolDefinition[] = [
  {
    name: "get_sla_policy",
    description:
      "Read the workspace's current response/resolution SLA targets, timezone, business hours, and date exceptions. Read this before updating the policy.",
    scope: "read",
    inputSchema: {},
    handler: async (_args, c) =>
      sla.getCurrentSlaPolicy(getRouteContext(c).companyId),
  },
  {
    name: "list_sla_policy_history",
    description: "Read the workspace's immutable SLA policy version history.",
    scope: "read",
    inputSchema: {},
    handler: async (_args, c) =>
      sla.listSlaPolicyHistory(getRouteContext(c).companyId),
  },
  {
    name: "list_quick_replies",
    description:
      "List or search workspace quick reply templates with full content. Check existing shortcuts before creating a template. Does not send messages.",
    scope: "read",
    inputSchema: listSchema.shape,
    handler: async (args, c) =>
      replies.getQuickReplies(
        getRouteContext(c).companyId,
        validated(listSchema, args),
      ),
  },
  {
    name: "get_quick_reply",
    description:
      "Read one workspace quick reply template, including its full content.",
    scope: "read",
    inputSchema: replyId,
    handler: async (args, c) => {
      const result = await replies.getQuickReplyById(
        getRouteContext(c).companyId,
        validated(z.object(replyId), args).quickReplyId,
      );
      if (!result) throw new McpToolError("Quick reply not found");
      return result;
    },
  },
  {
    name: "get_auto_reply_settings",
    description:
      "Read the first-contact automatic reply rule: enabled, template, wait time, and send mode. Outside-business-hours mode uses the SLA calendar.",
    scope: "read",
    inputSchema: {},
    handler: async (_args, c) =>
      autoReply.getAutoReplySettings(getRouteContext(c).companyId),
  },
];

export const settingsWriteTools: McpToolDefinition[] = [
  {
    name: "update_sla_policy",
    description:
      "Create an immediately active SLA policy version. Owner/admin only. Supply all targets, timezone, weekly schedule, and exceptions; read the current policy first to preserve settings. Existing cases retain their original policy. A retry creates another version; inspect history after an uncertain result.",
    scope: "write",
    inputSchema: createSlaPolicySchema.shape,
    handler: async (args, c) => {
      const { companyId, user, role } = getRouteContext(c);
      if (role !== "owner" && role !== "admin")
        throw new McpToolError(
          "Only workspace owners and admins can update the SLA policy",
        );
      return sla.createSlaPolicy(
        companyId,
        validated(createSlaPolicySchema, args),
        user.id,
      );
    },
  },
  {
    name: "create_quick_reply",
    description:
      "Create a shared workspace text template with shortcut, title, and content. Check list_quick_replies for an existing shortcut first. Does not send a message.",
    scope: "write",
    inputSchema: createQuickReplySchema.shape,
    handler: async (args, c) => {
      const { companyId, user } = getRouteContext(c);
      return replies.createQuickReply(
        companyId,
        user.id,
        validated(createQuickReplySchema, args),
      );
    },
  },
  {
    name: "update_quick_reply",
    description:
      "Edit a shared quick reply's shortcut, title, or content; omitted fields stay unchanged. Content changes also update scheduled first-contact replies using this template.",
    scope: "write",
    inputSchema: editSchema.shape,
    handler: async (args, c) => {
      const { quickReplyId, ...input } = validated(editSchema, args);
      if (Object.keys(input).length === 0)
        throw new McpToolError("Provide at least one field to update");
      const result = await replies.updateQuickReply(
        getRouteContext(c).companyId,
        quickReplyId,
        input,
      );
      if (!result) throw new McpToolError("Quick reply not found");
      return result;
    },
  },
  {
    name: "delete_quick_reply",
    description:
      "Delete a workspace quick reply template. This also disables an automatic reply rule using it and cancels its pending automatic replies. Confirm the intended template before deleting.",
    scope: "write",
    inputSchema: replyId,
    handler: async (args, c) => {
      const deleted = await replies.deleteQuickReply(
        getRouteContext(c).companyId,
        validated(z.object(replyId), args).quickReplyId,
      );
      if (!deleted) throw new McpToolError("Quick reply not found");
      return { deleted: true };
    },
  },
  {
    name: "update_auto_reply_settings",
    description:
      "Replace the first-contact automatic reply rule. HIGH IMPACT: enabling it authorizes future outbound replies; confirm template wording, delay, and send mode. Direct chats only, once per contact, excluding history sync; skips sending if the team replies during the wait. Delay is 1–1440 minutes. Use always or outside_business_hours (SLA calendar). Read current settings first. Saving cancels pending automatic replies; future first contacts use the new rule. A template is required when enabled.",
    scope: "write",
    inputSchema: updateAutoReplySettingsSchema.innerType().shape,
    handler: async (args, c) => {
      const { companyId, user } = getRouteContext(c);
      return autoReply.updateAutoReplySettings(
        companyId,
        user.id,
        validated(updateAutoReplySettingsSchema, args),
      );
    },
  },
];
