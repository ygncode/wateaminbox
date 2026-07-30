import { describe, expect, test } from "bun:test";
import {
  SCHEDULE_MAX_HORIZON_MS,
  SCHEDULE_MIN_LEAD_MS,
  scheduleMessageSchema,
} from "../lib/schemas/index.js";
import {
  formatScheduledMessage,
  getScheduleRetryDelayMs,
  type ScheduledMessageRow,
} from "./scheduled-message.service.js";

describe("scheduleMessageSchema", () => {
  const valid = {
    contactId: crypto.randomUUID(),
    content: "See you tomorrow!",
    scheduledAt: "2030-01-01T09:00:00.000Z",
  };

  test("accepts a well-formed request", () => {
    const parsed = scheduleMessageSchema.parse(valid);
    expect(parsed.content).toBe("See you tomorrow!");
    expect(parsed.replyToMessageId).toBeUndefined();
  });

  test("accepts offset timestamps", () => {
    expect(() =>
      scheduleMessageSchema.parse({
        ...valid,
        scheduledAt: "2030-01-01T16:30:00+07:00",
      }),
    ).not.toThrow();
  });

  test("rejects empty content", () => {
    expect(() =>
      scheduleMessageSchema.parse({ ...valid, content: "" }),
    ).toThrow();
  });

  test("rejects non-ISO scheduledAt", () => {
    expect(() =>
      scheduleMessageSchema.parse({ ...valid, scheduledAt: "tomorrow 9am" }),
    ).toThrow();
  });

  test("rejects non-UUID contactId", () => {
    expect(() =>
      scheduleMessageSchema.parse({ ...valid, contactId: "not-a-uuid" }),
    ).toThrow();
  });

  test("lead-time bounds are sane", () => {
    expect(SCHEDULE_MIN_LEAD_MS).toBeGreaterThan(0);
    expect(SCHEDULE_MAX_HORIZON_MS).toBeGreaterThan(SCHEDULE_MIN_LEAD_MS);
  });
});

describe("getScheduleRetryDelayMs", () => {
  test("backs off exponentially and caps at 15 minutes", () => {
    expect(getScheduleRetryDelayMs(1)).toBe(60_000);
    expect(getScheduleRetryDelayMs(2)).toBe(120_000);
    expect(getScheduleRetryDelayMs(10)).toBe(15 * 60_000);
    expect(getScheduleRetryDelayMs(100)).toBe(15 * 60_000);
  });
});

describe("formatScheduledMessage", () => {
  test("maps a row to the camelCase DTO with ISO timestamps", () => {
    const now = new Date("2026-07-30T10:00:00.000Z");
    const row: ScheduledMessageRow = {
      id: "11111111-1111-4111-8111-111111111111",
      contact_id: "22222222-2222-4222-8222-222222222222",
      content: "hello",
      message_type: "text",
      reply_to_message_id: null,
      scheduled_at: new Date("2026-07-31T09:00:00.000Z"),
      status: "scheduled",
      attempts: 0,
      next_attempt_at: new Date("2026-07-31T09:00:00.000Z"),
      last_error: null,
      sent_message_id: null,
      created_by: "33333333-3333-4333-8333-333333333333",
      canceled_by: null,
      canceled_at: null,
      sent_at: null,
      created_at: now,
      updated_at: now,
    };

    expect(formatScheduledMessage(row, "Aye Chan")).toEqual({
      id: row.id,
      contactId: row.contact_id,
      content: "hello",
      messageType: "text",
      replyToMessageId: null,
      scheduledAt: "2026-07-31T09:00:00.000Z",
      status: "scheduled",
      attempts: 0,
      lastError: null,
      sentMessageId: null,
      createdBy: row.created_by,
      createdByName: "Aye Chan",
      canceledAt: null,
      sentAt: null,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
    });
  });
});
