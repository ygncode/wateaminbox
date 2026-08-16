import { describe, expect, test } from "bun:test";
import {
  isWithinQuietHours,
  type NotificationRecipientCandidate,
  selectIncomingMessageRecipientIds,
} from "./notification-recipient.service.js";
import { ROLE_PRESETS } from "./permission.service.js";

/**
 * Defaults to a member whose can_view_all_chats override is off, so these
 * cases stay about visibility rules rather than the role preset's default.
 */
const candidate = (
  overrides: Partial<NotificationRecipientCandidate> & { userId: string },
): NotificationRecipientCandidate => ({
  permissions: { ...ROLE_PRESETS.member, can_view_all_chats: false },
  isAssignee: false,
  notificationsEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: "UTC",
  mutedContacts: [],
  ...overrides,
});

describe("incoming message notification recipients", () => {
  test("includes all-chat members and the active assignee only", () => {
    const recipients = selectIncomingMessageRecipientIds({
      contactJid: "15551234567:2@s.whatsapp.net",
      fromMe: false,
      isHistorySync: false,
      candidates: [
        candidate({ userId: "all", permissions: ROLE_PRESETS.admin }),
        candidate({ userId: "assigned", isAssignee: true }),
        candidate({ userId: "unauthorized" }),
      ],
    });
    expect(recipients).toEqual(["all", "assigned"]);
  });

  test("excludes disabled, muted and quiet-hours users", () => {
    const now = new Date("2025-01-01T23:00:00.000Z");
    const recipients = selectIncomingMessageRecipientIds({
      contactJid: "15551234567:4@s.whatsapp.net",
      fromMe: false,
      isHistorySync: false,
      now,
      candidates: [
        candidate({
          userId: "disabled",
          isAssignee: true,
          notificationsEnabled: false,
        }),
        candidate({
          userId: "muted",
          isAssignee: true,
          mutedContacts: ["15551234567@s.whatsapp.net"],
        }),
        candidate({
          userId: "quiet",
          isAssignee: true,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:00",
        }),
        candidate({ userId: "eligible", isAssignee: true }),
      ],
    });
    expect(recipients).toEqual(["eligible"]);
  });

  test("never selects own or history-sync message recipients", () => {
    const candidates = [candidate({ userId: "assigned", isAssignee: true })];
    expect(
      selectIncomingMessageRecipientIds({
        candidates,
        contactJid: "1@s.whatsapp.net",
        fromMe: true,
        isHistorySync: false,
      }),
    ).toEqual([]);
    expect(
      selectIncomingMessageRecipientIds({
        candidates,
        contactJid: "1@s.whatsapp.net",
        fromMe: false,
        isHistorySync: true,
      }),
    ).toEqual([]);
  });
});

describe("quiet hours", () => {
  test("handles overnight ranges and timezone conversion", () => {
    const now = new Date("2025-01-01T04:30:00.000Z");
    expect(
      isWithinQuietHours({
        now,
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours({
        now,
        start: "22:00",
        end: "07:00",
        timezone: "America/Los_Angeles",
      }),
    ).toBe(false);
  });

  test("uses an exclusive end boundary", () => {
    expect(
      isWithinQuietHours({
        now: new Date("2025-01-01T07:00:00Z"),
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      }),
    ).toBe(false);
  });
});
