import { describe, expect, test } from "bun:test";
import {
  buildPreferenceUpdateData,
  DEFAULT_PREFERENCES,
  normalizeContactJid,
} from "./notification-preferences.service.js";

describe("notification preference mapping", () => {
  test("uses enabled defaults without claiming browser permission", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      notificationsEnabled: true,
      timezone: null,
      mutedContacts: [],
    });
    expect(DEFAULT_PREFERENCES).not.toHaveProperty("permission");
  });

  test("maps API fields and deduplicates normalized JIDs", () => {
    expect(
      buildPreferenceUpdateData(
        {
          notificationsEnabled: false,
          timezone: "Asia/Yangon",
          mutedContacts: [
            "15551234567:4@s.whatsapp.net",
            "15551234567@s.whatsapp.net",
          ],
        },
        new Date(0),
      ),
    ).toEqual({
      notifications_enabled: false,
      timezone: "Asia/Yangon",
      muted_contacts: ["15551234567@s.whatsapp.net"],
      updated_at: new Date(0),
    });
  });

  test("normalizes device suffixes for idempotent mute matching", () => {
    expect(normalizeContactJid("15551234567:4@s.whatsapp.net")).toBe(
      "15551234567@s.whatsapp.net",
    );
  });
});
