import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { whatsAppEventEnvelopeSchema } from "../nats/client.js";
import { emailSchema, paginationSchema, uuidSchema } from "../schemas.js";
import { apiTokenIdParamSchema } from "./api-token.js";
import { bulkAudienceSchema } from "./bulk-job.js";
import { createContactSchema, listContactsQuerySchema } from "./contact.js";
import { listConversationMessagesQuerySchema } from "./conversation.js";
import { listGroupsQuerySchema, participantJidsSchema } from "./group.js";
import {
  batchStarSchema,
  listMessagesQuerySchema,
  scheduleMessageSchema,
  sendMessageSchema,
} from "./message.js";
import {
  createNotificationSchema,
  listNotificationsQuerySchema,
} from "./notification.js";
import { pushSubscriptionSchema } from "./push-subscription.js";
import {
  listQuickRepliesQuerySchema,
  updateAutoReplySettingsSchema,
} from "./quick-replies.js";
import {
  offsetDateTimeSchema,
  utcDateTimeSchema,
  urlStringSchema,
} from "./string-contracts.js";
import { postStatusSchema } from "./status.js";

const guid = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

describe("Zod 4 preserves existing valid-input contracts", () => {
  test("GUID-shaped IDs retain v3 acceptance without version/variant restrictions", () => {
    for (const id of [
      guid,
      guid.toLowerCase(),
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "550e8400-e29b-41d4-a716-446655440000",
    ]) {
      expect(uuidSchema.parse(id)).toBe(id);
      expect(apiTokenIdParamSchema.parse({ id })).toEqual({ id });
      expect(
        createContactSchema.parse({
          connectionId: id,
          phoneNumber: "123456789",
        }).connectionId,
      ).toBe(id);
      expect(
        listConversationMessagesQuerySchema.parse({ cursor: id }).cursor,
      ).toBe(id);
      expect(batchStarSchema.parse({ messageIds: [id] })).toEqual({
        messageIds: [id],
        star: true,
      });
    }
    for (const invalid of [
      "not-a-guid",
      guid.replaceAll("-", ""),
      ` ${guid}`,
      guid.replace("A", "G"),
    ]) {
      expect(uuidSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("defaults, query coercion, stripping unknown keys and JID normalization are unchanged", () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(
      paginationSchema.parse({ limit: "10", offset: "2", tenantId: guid }),
    ).toEqual({ limit: 10, offset: 2 });
    expect(listContactsQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
      includeGroups: false,
      assignedToMe: false,
      unassigned: false,
      unreadOnly: false,
    });
    expect(
      bulkAudienceSchema.parse({ contactIds: [guid], unknown: "discard" }),
    ).toEqual({ tagIds: [], contactIds: [guid] });
    expect(
      participantJidsSchema.parse([
        " 15551234567:2@s.whatsapp.net ",
        "15551234567@s.whatsapp.net",
      ]),
    ).toEqual(["15551234567@s.whatsapp.net"]);
    expect(sendMessageSchema.parse({ contactId: guid })).toEqual({
      contactId: guid,
      messageType: "text",
    });
  });

  test("unbounded integer offsets do not silently acquire v4's safe-integer ceiling", () => {
    for (const schema of [
      listGroupsQuerySchema,
      listQuickRepliesQuerySchema,
      listNotificationsQuerySchema,
    ]) {
      expect(schema.parse({ offset: String(2 ** 53) }).offset).toBe(2 ** 53);
      expect(schema.safeParse({ offset: "1.5" }).success).toBe(false);
      expect(schema.safeParse({ offset: "-1" }).success).toBe(false);
    }
  });

  test("datetime strings retain optional seconds, basic offsets and original spelling", () => {
    for (const value of [
      "2030-01-02T12:34Z",
      "2030-01-02T12:34:56Z",
      "2030-01-02T12:34:56.123456Z",
      "2030-01-02T12:34+0630",
      "2030-01-02T12:34:56-06:30",
      "2028-02-29T00:00Z",
    ]) {
      expect(offsetDateTimeSchema.parse(value)).toBe(value);
      expect(
        scheduleMessageSchema.parse({ contactId: guid, scheduledAt: value })
          .scheduledAt,
      ).toBe(value);
    }
    // Historically a syntactic offset check; scheduling still validates Date
    // and time horizon separately. Do not silently tighten this schema here.
    expect(offsetDateTimeSchema.parse("2030-01-02T12:34+9999")).toBe(
      "2030-01-02T12:34+9999",
    );
    expect(
      listMessagesQuerySchema.parse({ before: "2030-01-02T12:34Z" }).before,
    ).toBe("2030-01-02T12:34Z");
    expect(utcDateTimeSchema.safeParse("2030-01-02T12:34+0630").success).toBe(
      false,
    );
    for (const invalid of [
      "2030-02-29T12:34Z",
      "2030-01-02T24:00Z",
      "2030-01-02T12:60Z",
      "2030-01-02T12:34",
      "2030-01-02T12:34+06",
      "2030-01-02T12:34Z\n",
    ]) {
      expect(offsetDateTimeSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("URLs are validated without normalizing the wire value", () => {
    for (const value of [
      "https://example.com/a",
      " https://example.com/a ",
      "https://example.com/a\tb",
      "mailto:person@example.com",
      "s3://media/key",
    ]) {
      expect(urlStringSchema.parse(value)).toBe(value);
      expect(
        sendMessageSchema.parse({ contactId: guid, mediaUrl: value }).mediaUrl,
      ).toBe(value);
    }
    expect(urlStringSchema.safeParse("not a URL").success).toBe(false);
    const keys = { p256dh: "public", auth: "test" };
    expect(
      pushSubscriptionSchema.parse({
        endpoint: " https://example.com/push ",
        keys,
      }).endpoint,
    ).toBe(" https://example.com/push ");
    expect(
      pushSubscriptionSchema.safeParse({
        endpoint: "http://example.com/push",
        keys,
      }).success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({ endpoint: "not a URL", keys }).success,
    ).toBe(false);
  });

  test("email acceptance is unchanged for representative v3 addresses", () => {
    for (const email of [
      "user@example.com",
      "a.b+c_d-e'f@sub.example.com",
      "USER@EXAMPLE.COM",
    ])
      expect(emailSchema.parse(email)).toBe(email);
    for (const email of [
      ".user@example.com",
      "user..name@example.com",
      "user@example",
      " user@example.com",
    ])
      expect(emailSchema.safeParse(email).success).toBe(false);
  });

  test("record values and NATS envelope defaults retain their contract", () => {
    const payload = { nested: { values: [1, false, null] }, text: "unchanged" };
    expect(
      whatsAppEventEnvelopeSchema.parse({
        type: "message",
        companyId: guid,
        connectionId: guid,
        payload,
        timestamp: "2030-01-01",
        extra: true,
      }),
    ).toEqual({
      contractVersion: 1,
      type: "message",
      companyId: guid,
      connectionId: guid,
      payload,
      timestamp: "2030-01-01",
    });
    expect(createNotificationSchema.shape.metadata.parse(payload)).toEqual(
      payload,
    );
    expect(createNotificationSchema.shape.metadata.safeParse([]).success).toBe(
      false,
    );
  });

  test("cross-field refinements remain enforced after removal of innerType()", () => {
    const value = {
      enabled: true,
      quickReplyId: null,
      delayMinutes: 1,
      sendMode: "always",
    };
    expect(
      z.object(updateAutoReplySettingsSchema.shape).safeParse(value).success,
    ).toBe(true);
    // MCP reparses the full schema before calling the service.
    expect(updateAutoReplySettingsSchema.safeParse(value).success).toBe(false);
    expect(
      updateAutoReplySettingsSchema.safeParse({ ...value, quickReplyId: guid })
        .success,
    ).toBe(true);
    expect(postStatusSchema.safeParse({ type: "text" }).success).toBe(false);
    expect(postStatusSchema.parse({ type: "text", content: "hello" })).toEqual({
      type: "text",
      content: "hello",
    });
  });
});
