import { describe, expect, test } from "bun:test";
import {
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
    ).toBe("15551234567");
    expect(getMessagePreview({ messageType: "image" })).toBe("Sent an image");
  });
});
