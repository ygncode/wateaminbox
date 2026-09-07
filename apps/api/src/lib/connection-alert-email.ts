import {
  type BrandedEmailContent,
  emailHeaderText,
  renderBrandedEmail,
  renderPlainTextEmail,
} from "./email-template.js";
import { env } from "./env.js";

export interface ConnectionAlertEmail {
  kind: "logged_out" | "disconnected";
  workspaceId: string;
  workspaceName: string;
  connectionName: string;
  occurredAt: Date;
}

export function renderConnectionAlertEmail(alert: ConnectionAlertEmail) {
  const loggedOut = alert.kind === "logged_out";
  const url = new URL(
    `/w/${encodeURIComponent(alert.workspaceId)}/settings/connections`,
    env.APP_URL,
  ).toString();
  const content: BrandedEmailContent = {
    preheader: loggedOut
      ? "Scan a new QR code to reconnect your WhatsApp number."
      : "Your WhatsApp connection has not recovered after five minutes.",
    eyebrow: "Connection alert",
    title: loggedOut
      ? "Reconnect your WhatsApp number"
      : "Your WhatsApp connection is offline",
    paragraphs: loggedOut
      ? [
          "WhatsApp has unlinked this connection. It needs a new QR scan before your team can send and receive messages through it again.",
          "Open the connection in WATeamInbox to start pairing. On your phone, open WhatsApp → Linked devices → Link a device, then scan the new QR code.",
        ]
      : [
          "This WhatsApp connection has been offline for at least five minutes. Your team cannot send or receive messages through it while it is disconnected.",
          "Open WATeamInbox to check its current status and reconnect if needed.",
        ],
    details: [
      { label: "Workspace", value: alert.workspaceName },
      { label: "Connection", value: alert.connectionName },
      {
        label: loggedOut ? "Logged out at (UTC)" : "Offline since (UTC)",
        value: alert.occurredAt
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d{3}Z$/, ""),
      },
    ],
    action: {
      label: loggedOut ? "Reconnect WhatsApp" : "Check connection",
      url,
    },
    note: "You received this service alert because you are a workspace owner or admin. If the connection has already recovered, no action is needed.",
  };
  return {
    subject: `${loggedOut ? "WhatsApp logged out" : "WhatsApp connection offline"} — ${emailHeaderText(alert.workspaceName)}`,
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  };
}
