import { describe, expect, test } from "bun:test";
import {
  GROUP_MAX_PARTICIPANTS,
  GROUP_PARTICIPANT_BATCH_LIMIT,
} from "@wateaminbox/shared";
import { z } from "zod";
import { createApiTokenSchema } from "./api-token.js";
import { bulkAudienceSchema } from "./bulk-job.js";
import { listContactsQuerySchema } from "./contact.js";
import { sendConversationMessageSchema } from "./conversation.js";
import { createGroupSchema, participantJidsSchema } from "./group.js";
import { batchStarSchema, sendMessageSchema } from "./message.js";
import { updatePreferencesSchema } from "./notification.js";
import { exceptionsSchema, weeklyScheduleSchema } from "./sla-policy.js";

const guid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const cases: {
  name: string;
  schema: z.ZodType;
  input: (items: unknown[]) => unknown;
  path: (string | number)[];
  max: number;
  validItem: unknown;
}[] = [
  {
    name: "batch messages",
    schema: batchStarSchema,
    input: (messageIds) => ({ messageIds }),
    path: ["messageIds"],
    max: 50,
    validItem: guid,
  },
  {
    name: "message mentions",
    schema: sendMessageSchema,
    input: (mentionedJids) => ({ contactId: guid, mentionedJids }),
    path: ["mentionedJids"],
    max: 100,
    validItem: "15551234567@s.whatsapp.net",
  },
  {
    name: "conversation mentions",
    schema: sendConversationMessageSchema,
    input: (mentionedJids) => ({ mentionedJids }),
    path: ["mentionedJids"],
    max: 100,
    validItem: "15551234567@s.whatsapp.net",
  },
  {
    name: "audience tags",
    schema: bulkAudienceSchema,
    input: (tagIds) => ({ tagIds }),
    path: ["tagIds"],
    max: 50,
    validItem: guid,
  },
  {
    name: "audience contacts",
    schema: bulkAudienceSchema,
    input: (contactIds) => ({ contactIds }),
    path: ["contactIds"],
    max: 500,
    validItem: guid,
  },
  {
    name: "participant batch",
    schema: participantJidsSchema,
    input: (items) => items,
    path: [],
    max: GROUP_PARTICIPANT_BATCH_LIMIT,
    validItem: "15551234567:2@s.whatsapp.net",
  },
  {
    name: "group creation",
    schema: createGroupSchema,
    input: (participantJids) => ({
      connectionId: guid,
      name: "Group",
      participantJids,
    }),
    path: ["participantJids"],
    max: GROUP_MAX_PARTICIPANTS - 1,
    validItem: "15551234567@s.whatsapp.net",
  },
  {
    name: "muted contacts",
    schema: updatePreferencesSchema,
    input: (mutedContacts) => ({ mutedContacts }),
    path: ["mutedContacts"],
    max: 1000,
    validItem: "15551234567@s.whatsapp.net",
  },
];

// Proxy index reads measure actual element traversal, not timing or heap noise.
function invalidCollection() {
  let reads = 0;
  const items = new Proxy(
    Array.from({ length: 10_000 }, () => null),
    {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) reads++;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  return { items, reads: () => reads };
}

function expectSizeIssue(
  result: z.ZodSafeParseResult<unknown>,
  path: (string | number)[],
) {
  expect(result.success).toBe(false);
  if (result.success)
    throw new Error("Expected oversized collection rejection");
  expect(result.error.issues).toHaveLength(1);
  expect(result.error.issues[0]).toMatchObject({ code: "too_big", path });
}

describe("GHSA-mrhx-c7xc-m3w5: existing upper bounds gate element parsing", () => {
  for (const entry of cases) {
    test(`${entry.name}: oversized invalid collection does no element work`, async () => {
      const oversized = invalidCollection();
      expectSizeIssue(
        entry.schema.safeParse(entry.input(oversized.items)),
        entry.path,
      );
      expectSizeIssue(
        await entry.schema.safeParseAsync(entry.input(oversized.items)),
        entry.path,
      );
      expect(oversized.reads()).toBe(0);
    });

    test(`${entry.name}: exact existing boundary succeeds; max + 1 fails`, () => {
      const valid = Array.from({ length: entry.max }, () => entry.validItem);
      expect(entry.schema.safeParse(entry.input(valid)).success).toBe(true);
      expectSizeIssue(
        entry.schema.safeParse(entry.input([...valid, entry.validItem])),
        entry.path,
      );
    });
  }

  test("length-bounded and refined collections stop before walking invalid children", async () => {
    for (const schema of [
      weeklyScheduleSchema,
      exceptionsSchema,
      createApiTokenSchema.shape.scopes,
    ]) {
      const oversized = invalidCollection();
      expectSizeIssue(await schema.safeParseAsync(oversized.items), []);
      expect(oversized.reads()).toBe(0);
    }
  });

  test("refined collections retain valid length/max boundaries", () => {
    expect(
      createApiTokenSchema.parse({ name: "token", scopes: ["read", "write"] })
        .scopes,
    ).toEqual(["read", "write"]);
    const intervals = Array.from({ length: 12 }, (_, index) => ({
      start: `${String(index * 2).padStart(2, "0")}:00`,
      end: `${String(index * 2 + 1).padStart(2, "0")}:00`,
    }));
    const days = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      open: weekday === 0,
      intervals: weekday === 0 ? intervals : [],
    }));
    expect(weeklyScheduleSchema.parse(days)).toEqual(days);
    expect(weeklyScheduleSchema.safeParse(days.slice(0, 6)).success).toBe(
      false,
    );
    const exceptions = Array.from({ length: 366 }, (_, index) => ({
      date: new Date(Date.UTC(2028, 0, index + 1)).toISOString().slice(0, 10),
      closed: true,
    }));
    expect(exceptionsSchema.parse(exceptions)).toEqual(exceptions);
    expectSizeIssue(
      exceptionsSchema.safeParse([
        ...exceptions,
        { date: "2029-01-01", closed: true },
      ]),
      [],
    );
  });

  test("nested daily intervals keep the existing size gate", () => {
    const oversized = invalidCollection();
    const days = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      open: weekday === 0,
      intervals: weekday === 0 ? oversized.items : [],
    }));
    expectSizeIssue(weeklyScheduleSchema.safeParse(days), [0, "intervals"]);
    expect(oversized.reads()).toBe(0);
  });

  test("query pipeline rejects oversized invalid tags with one collection issue", () => {
    expectSizeIssue(
      listContactsQuerySchema.safeParse({
        tagIds: Array(10_000).fill("invalid").join(","),
      }),
      ["tagIds"],
    );
    const tagIds = Array(50).fill(guid);
    expect(
      listContactsQuerySchema.parse({ tagIds: tagIds.join(",") }).tagIds,
    ).toEqual(tagIds);
  });

  test("oversized input starts no asynchronous element work/promises or collection refinements", async () => {
    let elementCalls = 0;
    let collectionCalls = 0;
    const element = z.preprocess(async (value) => {
      elementCalls++;
      return value;
    }, z.string());
    const schema = z
      .array(element)
      .max(50)
      .refine(() => {
        collectionCalls++;
        return true;
      });
    const oversized = Array(10_000).fill(null);
    // safeParse would throw on an async element if the gate did not run first.
    expectSizeIssue(schema.safeParse(oversized), []);
    expectSizeIssue(await schema.safeParseAsync(oversized), []);
    expect(elementCalls).toBe(0);
    expect(collectionCalls).toBe(0);
    const boundary = Array(50).fill("valid");
    expect(await schema.parseAsync(boundary)).toEqual(boundary);
    expect(elementCalls).toBe(50);
    expect(collectionCalls).toBe(1);
  });

  test("in-bound invalid elements still produce field-level issues", () => {
    const result = batchStarSchema.safeParse({ messageIds: ["invalid", guid] });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["messageIds", 0]);
  });

  test("the patch is not a global issue cap for unconstrained collections", () => {
    const result = z.array(z.string()).safeParse(Array(100).fill(null));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(100);
  });
});
