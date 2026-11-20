import { describe, expect, test } from "bun:test";
import {
  createAlertDeduper,
  decideIncomingAlert,
  getDesktopSenderName,
  getMessagePreview,
  isQuietHoursAt,
  shouldShowDesktopNotification,
} from "./desktop-notifications";
import { DEFAULT_NOTIFICATION_SETTINGS } from "./notifications";

const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, mutedContacts: [] };
describe("desktop notification decisions", () => {
  test("suppresses focused, own, muted, quiet and push-owned notifications", () => {
    const base = {
      settings,
      permission: "granted" as const,
      senderType: "contact",
      senderJid: "1@s.whatsapp.net",
      documentVisible: false,
      documentFocused: false,
      hasActivePushSubscription: false,
    };
    expect(shouldShowDesktopNotification(base)).toBe(true);
    expect(
      shouldShowDesktopNotification({
        ...base,
        documentVisible: true,
        documentFocused: true,
      }),
    ).toBe(false);
    expect(shouldShowDesktopNotification({ ...base, senderType: "user" })).toBe(
      false,
    );
    expect(
      shouldShowDesktopNotification({
        ...base,
        settings: { ...settings, mutedContacts: ["1:3@s.whatsapp.net"] },
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopNotification({
        ...base,
        hasActivePushSubscription: true,
      }),
    ).toBe(false);
  });

  test("handles overnight quiet-hour boundaries", () => {
    const quiet = {
      ...settings,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };
    expect(isQuietHoursAt(quiet, new Date(2025, 0, 1, 22, 0))).toBe(true);
    expect(isQuietHoursAt(quiet, new Date(2025, 0, 2, 7, 0))).toBe(false);
  });

  test("uses senderName then normalized phone fallback and formats previews", () => {
    expect(
      getDesktopSenderName({
        senderName: "Ada",
        senderJid: "1@s.whatsapp.net",
      }),
    ).toBe("Ada");
    expect(
      getDesktopSenderName({ senderJid: "15551234567:2@s.whatsapp.net" }),
    ).toBe("+15551234567");
    expect(getMessagePreview({ messageType: "image" })).toBe("Sent an image");
  });
});

describe("incoming alert decision", () => {
  const away = {
    settings,
    permission: "granted" as const,
    senderType: "contact",
    senderJid: "1@s.whatsapp.net",
    documentVisible: false,
    documentFocused: false,
    hasActivePushSubscription: false,
    isOpenConversation: false,
  };
  const looking = { ...away, documentVisible: true, documentFocused: true };

  test("notifies when the app is in the background", () => {
    expect(decideIncomingAlert(away)).toBe("notify");
  });

  test("stays quiet for the conversation already open on screen", () => {
    expect(decideIncomingAlert({ ...looking, isOpenConversation: true })).toBe(
      "none",
    );
  });

  test("plays only the sound for another chat while the app is in front", () => {
    expect(decideIncomingAlert(looking)).toBe("sound");
    expect(
      decideIncomingAlert({
        ...looking,
        settings: { ...settings, soundEnabled: false },
      }),
    ).toBe("none");
    // The in-app sound does not need browser notification permission.
    expect(decideIncomingAlert({ ...looking, permission: "denied" })).toBe(
      "sound",
    );
  });

  test("never alerts for own, history, quiet-hour or muted messages", () => {
    for (const input of [looking, away]) {
      expect(decideIncomingAlert({ ...input, senderType: "user" })).toBe(
        "none",
      );
      expect(decideIncomingAlert({ ...input, isHistorySync: true })).toBe(
        "none",
      );
      expect(
        decideIncomingAlert({
          ...input,
          settings: { ...settings, mutedContacts: ["1@s.whatsapp.net"] },
        }),
      ).toBe("none");
      expect(
        decideIncomingAlert({
          ...input,
          settings: {
            ...settings,
            quietHoursEnabled: true,
            quietHoursStart: "00:00",
            quietHoursEnd: "23:59",
          },
          now: new Date(2025, 0, 1, 12, 0),
        }),
      ).toBe("none");
    }
  });

  test("defers to Web Push in the background, as before", () => {
    expect(
      decideIncomingAlert({ ...away, hasActivePushSubscription: true }),
    ).toBe("none");
  });

  test("alerts each message once", () => {
    const first = createAlertDeduper(2);
    expect(first("a")).toBe(true);
    expect(first("a")).toBe(false);
    expect(first("b")).toBe(true);
    expect(first("c")).toBe(true);
    // Bounded: the oldest id is forgotten once capacity is exceeded.
    expect(first("a")).toBe(true);
  });

  test("previews Telegram-only message types", () => {
    expect(getMessagePreview({ messageType: "voice" })).toBe(
      "Sent a voice message",
    );
    expect(getMessagePreview({ messageType: "sticker" })).toBe(
      "Sent a sticker",
    );
    expect(getMessagePreview({ messageType: "text", content: "hi" })).toBe(
      "hi",
    );
  });
});
