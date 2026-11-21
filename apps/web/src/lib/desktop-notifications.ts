import { extractPhoneFromJid, normalizeJid } from "@wateaminbox/shared";
import type { NotificationSettings } from "./notifications";
import { formatPhoneLikeText, formatPhoneNumber } from "./utils";

export interface DesktopNotificationDecisionInput {
  settings: NotificationSettings;
  permission: NotificationPermission;
  senderType?: string;
  senderJid?: string | null;
  /**
   * Every identity of the chat the message arrived in: the chat's own JID, its
   * contact id and its conversation ids. A mute stored against any of them
   * silences the chat, matching how the server filters push recipients.
   */
  chatKeys?: readonly (string | null | undefined)[];
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same comparison the API uses for mute tokens (notification-recipient). */
function muteTokenMatches(stored: string, key: string): boolean {
  if (UUID_PATTERN.test(stored) || UUID_PATTERN.test(key)) {
    return stored.toLowerCase() === key.toLowerCase();
  }
  return (normalizeJid(stored) ?? stored) === (normalizeJid(key) ?? key);
}

/**
 * Whether the message's chat (or, as before, its sender) is muted. Matching
 * only the sender left a muted group ringing: its messages carry the
 * participant's JID, while the mute is stored against the group.
 */
export function isMutedChat(
  input: Pick<
    DesktopNotificationDecisionInput,
    "settings" | "senderJid" | "chatKeys"
  >,
): boolean {
  const keys = [input.senderJid, ...(input.chatKeys ?? [])].filter(
    (key): key is string => Boolean(key),
  );
  if (keys.length === 0) return false;
  return input.settings.mutedContacts.some((muted) =>
    keys.some((key) => muteTokenMatches(muted, key)),
  );
}

export function shouldShowDesktopNotification(
  input: DesktopNotificationDecisionInput,
): boolean {
  if (input.senderType === "user" || input.isHistorySync) return false;
  if (input.documentVisible && input.documentFocused) return false;
  if (input.hasActivePushSubscription) return false;
  if (!input.settings.enabled || input.permission !== "granted") return false;
  if (isQuietHoursAt(input.settings, input.now)) return false;
  if (isMutedChat(input)) return false;
  return true;
}

/**
 * How to alert for one incoming message.
 *
 * - `notify`: a system notification (which plays the sound itself).
 * - `sound`: only the in-app sound - the app is in front of the user, but the
 *   message landed in a conversation they are not looking at.
 * - `none`: stay quiet.
 */
export type IncomingAlert = "notify" | "sound" | "none";

export interface IncomingAlertInput extends DesktopNotificationDecisionInput {
  /** The message arrived in the conversation currently open on screen. */
  isOpenConversation: boolean;
}

export function decideIncomingAlert(input: IncomingAlertInput): IncomingAlert {
  if (input.senderType === "user" || input.isHistorySync) return "none";
  if (isQuietHoursAt(input.settings, input.now)) return "none";
  // Muted means silent: no system notification and no in-app sound.
  if (isMutedChat(input)) return "none";

  if (input.documentVisible && input.documentFocused) {
    // Reading that very chat: the message is already on screen.
    if (input.isOpenConversation) return "none";
    return input.settings.soundEnabled ? "sound" : "none";
  }
  return shouldShowDesktopNotification(input) ? "notify" : "none";
}

/**
 * Remembers recently alerted message ids. The same message can reach the
 * browser twice - a Telegram photo is re-announced once its file is fetched,
 * and a reconnect can replay recent events - and must alert only once.
 */
export function createAlertDeduper(capacity = 200) {
  const seen = new Set<string>();
  return (messageId: string): boolean => {
    if (seen.has(messageId)) return false;
    seen.add(messageId);
    if (seen.size > capacity) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
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
    case "voice":
      return "Sent a voice message";
    case "video_note":
      return "Sent a video message";
    case "animation":
      return "Sent a GIF";
    case "sticker":
      return "Sent a sticker";
    case "contact":
      return "Shared a contact";
    case "poll":
      return "Sent a poll";
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
