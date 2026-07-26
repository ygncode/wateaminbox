import { extractPhoneFromJid, normalizeJid } from "@wateaminbox/shared";
import type { NotificationSettings } from "./notifications";
import { formatPhoneLikeText, formatPhoneNumber } from "./utils";

export interface DesktopNotificationDecisionInput {
  settings: NotificationSettings;
  permission: NotificationPermission;
  senderType?: string;
  senderJid?: string | null;
  isHistorySync?: boolean;
  documentVisible: boolean;
  documentFocused: boolean;
  hasActivePushSubscription: boolean;
  now?: Date;
}

export function isQuietHoursAt(
  settings: NotificationSettings,
  now: Date = new Date(),
): boolean {
  if (!settings.quietHoursEnabled) return false;
  const [startHour, startMinute] = settings.quietHoursStart
    .split(":")
    .map(Number);
  const [endHour, endMinute] = settings.quietHoursEnd.split(":").map(Number);
  const current = now.getHours() * 60 + now.getMinutes();
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (start === end) return false;
  return start > end
    ? current >= start || current < end
    : current >= start && current < end;
}

export function shouldShowDesktopNotification(
  input: DesktopNotificationDecisionInput,
): boolean {
  if (input.senderType === "user" || input.isHistorySync) return false;
  if (input.documentVisible && input.documentFocused) return false;
  if (input.hasActivePushSubscription) return false;
  if (!input.settings.enabled || input.permission !== "granted") return false;
  if (isQuietHoursAt(input.settings, input.now)) return false;
  const senderJid = normalizeJid(input.senderJid) ?? input.senderJid;
  if (
    senderJid &&
    input.settings.mutedContacts.some(
      (jid) => (normalizeJid(jid) ?? jid) === senderJid,
    )
  )
    return false;
  return true;
}

export function getDesktopSenderName(input: {
  senderName?: string | null;
  senderJid?: string | null;
  senderId?: string | null;
}): string {
  if (input.senderName?.trim()) {
    return formatPhoneLikeText(input.senderName);
  }
  const jid = normalizeJid(input.senderJid || input.senderId);
  const phone = extractPhoneFromJid(jid);
  return phone ? formatPhoneNumber(phone) : jid || "Unknown contact";
}

export function getMessagePreview(message: {
  messageType?: string;
  content?: string;
}): string {
  switch (message.messageType) {
    case "image":
      return "Sent an image";
    case "video":
      return "Sent a video";
    case "audio":
      return "Sent an audio message";
    case "document":
      return "Sent a document";
    case "location":
      return "Shared a location";
    case "template":
      return "Template message";
    default:
      return message.content?.slice(0, 100) || "New message";
  }
}
