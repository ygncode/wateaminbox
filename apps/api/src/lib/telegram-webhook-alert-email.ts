import {
  type BrandedEmailContent,
  emailHeaderText,
  renderBrandedEmail,
  renderPlainTextEmail,
} from "./email-template.js";
import { env } from "./env.js";

export interface TelegramWebhookAlertEmail {
  problem: "webhook_taken_over" | "webhook_missing";
  workspaceId: string;
  workspaceName: string;
  accountName: string;
}

export function renderTelegramWebhookAlertEmail(
  alert: TelegramWebhookAlertEmail,
) {
  const takenOver = alert.problem === "webhook_taken_over";
  const url = new URL(
    `/w/${encodeURIComponent(alert.workspaceId)}/settings/connections`,
    env.APP_URL,
  ).toString();
  const content: BrandedEmailContent = {
    preheader:
      "Customer messages to this Telegram bot are not reaching your inbox.",
    eyebrow: "Connection alert",
    title: "Your Telegram bot stopped delivering messages",
    paragraphs: [
      takenOver
        ? "Telegram is sending this bot's messages to another app. A Telegram bot can deliver to only one place, and something else that has this bot's token registered its own webhook, replacing ours."
        : "This bot's webhook was removed from Telegram, so its messages are not delivered anywhere.",
      "Messages sent to the bot in the meantime do not reach your inbox, and Telegram does not resend them. Reconnect the bot in WATeamInbox to receive new messages again. If another app shares this bot's token, give that app its own bot first, or it will take the webhook back.",
    ],
    details: [
      { label: "Workspace", value: alert.workspaceName },
      { label: "Telegram bot", value: alert.accountName },
    ],
    action: { label: "Reconnect the bot", url },
    note: "You received this service alert because you are a workspace owner or admin.",
  };
  return {
    subject: `Telegram bot not delivering messages — ${emailHeaderText(alert.workspaceName)}`,
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  };
}
