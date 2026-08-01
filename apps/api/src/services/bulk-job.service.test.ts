import { afterEach, describe, expect, test } from "bun:test";
import { getBulkConfig } from "../config/bulk.config.js";
import {
  createBulkJobSchema,
  previewBulkJobSchema,
} from "../lib/schemas/index.js";
import {
  buildBulkJobPreview,
  computeAudienceHash,
  deriveBulkJobOutcome,
  findUnknownTemplateVariables,
  renderBulkTemplate,
  type ResolvedAudience,
  resolveRecipientName,
} from "./bulk-job.service.js";

describe("findUnknownTemplateVariables", () => {
  test("accepts the supported variables in any spacing", () => {
    expect(findUnknownTemplateVariables("Hi {{name}}!")).toEqual([]);
    expect(findUnknownTemplateVariables("Hi {{ firstName }}!")).toEqual([]);
    expect(findUnknownTemplateVariables("No tokens at all")).toEqual([]);
    expect(findUnknownTemplateVariables("")).toEqual([]);
  });

  test("reports unknown variables once each", () => {
    expect(
      findUnknownTemplateVariables("Hi {{nick}}, {{nick}} and {{last_name}}"),
    ).toEqual(["nick", "last_name"]);
  });

  test("is case-sensitive and ignores single braces", () => {
    expect(findUnknownTemplateVariables("Hi {{Name}}")).toEqual(["Name"]);
    expect(findUnknownTemplateVariables("Hi {name}")).toEqual([]);
  });
});

describe("renderBulkTemplate", () => {
  const contact = {
    custom_name: "Aye Chan Ko",
    push_name: "AC",
    phone_number: "+959791112223",
  };

  test("renders name and firstName from the display-name chain", () => {
    expect(renderBulkTemplate("Hi {{name}} ({{firstName}})", contact)).toBe(
      "Hi Aye Chan Ko (Aye)",
    );
  });

  test("falls back custom_name → push_name → phone_number → empty", () => {
    expect(
      renderBulkTemplate("{{name}}", {
        custom_name: null,
        push_name: "Pushy",
        phone_number: "+95970",
      }),
    ).toBe("Pushy");
    expect(
      renderBulkTemplate("{{name}}", {
        custom_name: "  ",
        push_name: null,
        phone_number: "+95970",
      }),
    ).toBe("+95970");
    expect(
      renderBulkTemplate("Hi {{name}}!", {
        custom_name: null,
        push_name: null,
        phone_number: null,
      }),
    ).toBe("Hi !");
  });

  test("renders a stray unknown token as empty, never literal braces", () => {
    expect(renderBulkTemplate("Hi {{bogus}}", contact)).toBe("Hi ");
  });
});

describe("resolveRecipientName", () => {
  test("trims and falls through empty values", () => {
    expect(
      resolveRecipientName({
        custom_name: " ",
        push_name: "",
        phone_number: "+1",
      }),
    ).toBe("+1");
  });
});

describe("computeAudienceHash", () => {
  const eligible = (contactId: string, connectionId: string, jid = "j1") => ({
    contactId,
    connectionId,
    jid,
  });
  const skipped = (contactId: string, skipReason: string) => ({
    contactId,
    skipReason,
  });

  test("is order-independent and deterministic", () => {
    const a = computeAudienceHash(
      [eligible("b", "c1"), eligible("a", "c1")],
      [skipped("x", "no_jid")],
    );
    const b = computeAudienceHash(
      [eligible("a", "c1"), eligible("b", "c1")],
      [skipped("x", "no_jid")],
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs for different recipient sets", () => {
    expect(computeAudienceHash([eligible("a", "c1")], [])).not.toBe(
      computeAudienceHash([eligible("a", "c1"), eligible("b", "c1")], []),
    );
    expect(computeAudienceHash([], [])).not.toBe(
      computeAudienceHash([eligible("a", "c1")], []),
    );
  });

  test("changes when an eligible contact moves between connections", () => {
    expect(computeAudienceHash([eligible("a", "c1")], [])).not.toBe(
      computeAudienceHash([eligible("a", "c2")], []),
    );
  });

  test("changes when a target jid changes", () => {
    expect(computeAudienceHash([eligible("a", "c1", "j1")], [])).not.toBe(
      computeAudienceHash([eligible("a", "c1", "j2")], []),
    );
  });

  test("covers the skipped set and its classification", () => {
    const base = computeAudienceHash([], [skipped("a", "no_jid")]);
    expect(base).not.toBe(computeAudienceHash([], [skipped("a", "blocked")]));
    expect(base).not.toBe(computeAudienceHash([], []));
    // Moving a contact from skipped to eligible changes the hash even
    // though the union of contact IDs is identical.
    expect(computeAudienceHash([eligible("a", "c1")], [])).not.toBe(
      computeAudienceHash([], [skipped("a", "no_jid")]),
    );
  });
});

describe("deriveBulkJobOutcome", () => {
  const base = {
    total: 5,
    pending: 0,
    processing: 0,
    sent: 5,
    failed: 0,
    canceled: 0,
    skipped: 0,
  };

  test("completes cleanly only when every recipient was handed off", () => {
    expect(deriveBulkJobOutcome(base)).toBe("completed");
  });

  test("reports completed_with_errors when any leaf failed", () => {
    expect(deriveBulkJobOutcome({ ...base, sent: 4, failed: 1 })).toBe(
      "completed_with_errors",
    );
  });

  test("reports completed_with_errors when any recipient was skipped", () => {
    expect(deriveBulkJobOutcome({ ...base, sent: 4, skipped: 1 })).toBe(
      "completed_with_errors",
    );
  });
});

describe("buildBulkJobPreview", () => {
  const recipient = (
    contactId: string,
    connectionId: string,
    skipReason: ResolvedAudience["eligible"][number]["skipReason"] = null,
  ) => ({
    contactId,
    jid: `${contactId}@s.whatsapp.net`,
    connectionId,
    connectionName: `Line ${connectionId}`,
    customName: null,
    pushName: null,
    phoneNumber: null,
    skipReason,
  });

  test("groups per connection, tallies skip reasons, and estimates pacing", () => {
    const resolved: ResolvedAudience = {
      eligible: [
        recipient("c1", "conn-a"),
        recipient("c2", "conn-a"),
        recipient("c3", "conn-b"),
      ],
      skipped: [
        recipient("c4", "conn-a", "no_jid"),
        recipient("c5", "conn-a", "no_jid"),
        recipient("c6", "conn-b", "blocked"),
      ],
      audienceHash: "hash",
    };
    const preview = buildBulkJobPreview(resolved);

    expect(preview.recipientCount).toBe(3);
    expect(preview.skippedCount).toBe(3);
    expect(preview.audienceHash).toBe("hash");
    expect(preview.perConnection).toEqual([
      {
        connectionId: "conn-a",
        connectionName: "Line conn-a",
        recipientCount: 2,
      },
      {
        connectionId: "conn-b",
        connectionName: "Line conn-b",
        recipientCount: 1,
      },
    ]);
    expect(preview.skippedByReason).toEqual({ no_jid: 2, blocked: 1 });
    // The busiest connection (2 recipients) drives the estimate.
    expect(preview.estimatedDurationSeconds).toBe(
      2 * preview.limits.sendIntervalSeconds,
    );
  });

  test("handles an empty audience", () => {
    const preview = buildBulkJobPreview({
      eligible: [],
      skipped: [],
      audienceHash: "empty",
    });
    expect(preview.recipientCount).toBe(0);
    expect(preview.estimatedDurationSeconds).toBe(0);
    expect(preview.perConnection).toEqual([]);
  });
});

describe("getBulkConfig", () => {
  const savedEnv = {
    BULK_SEND_INTERVAL_MS: process.env.BULK_SEND_INTERVAL_MS,
    BULK_MAX_RECIPIENTS_PER_JOB: process.env.BULK_MAX_RECIPIENTS_PER_JOB,
    BULK_DAILY_CAP_PER_CONNECTION: process.env.BULK_DAILY_CAP_PER_CONNECTION,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("uses conservative defaults", () => {
    delete process.env.BULK_SEND_INTERVAL_MS;
    delete process.env.BULK_MAX_RECIPIENTS_PER_JOB;
    delete process.env.BULK_DAILY_CAP_PER_CONNECTION;
    expect(getBulkConfig()).toEqual({
      sendIntervalMs: 12_000,
      maxRecipientsPerJob: 100,
      dailyCapPerConnection: 200,
    });
  });

  test("clamps dangerously low intervals and absurd caps", () => {
    process.env.BULK_SEND_INTERVAL_MS = "50";
    process.env.BULK_MAX_RECIPIENTS_PER_JOB = "999999";
    process.env.BULK_DAILY_CAP_PER_CONNECTION = "999999";
    const config = getBulkConfig();
    // The hard pacing floor is 10s; no configuration may go below it.
    expect(config.sendIntervalMs).toBe(10_000);
    expect(config.maxRecipientsPerJob).toBe(500);
    expect(config.dailyCapPerConnection).toBe(1_000);
  });

  test("ignores garbage values", () => {
    process.env.BULK_SEND_INTERVAL_MS = "not-a-number";
    process.env.BULK_MAX_RECIPIENTS_PER_JOB = "-5";
    expect(getBulkConfig().sendIntervalMs).toBe(12_000);
    expect(getBulkConfig().maxRecipientsPerJob).toBe(100);
  });
});

describe("bulk job schemas", () => {
  test("createBulkJobSchema accepts a complete payload", () => {
    const parsed = createBulkJobSchema.parse({
      name: "July promo",
      audience: { tagIds: [crypto.randomUUID()], contactIds: [] },
      content: "Hi {{name}}",
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      audienceHash: "a".repeat(64),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(parsed.messageType).toBe("text");
    expect(parsed.audience.connectionId).toBeUndefined();
  });

  test("rejects an audience with neither tags nor contacts", () => {
    expect(() =>
      previewBulkJobSchema.parse({
        audience: { tagIds: [], contactIds: [] },
      }),
    ).toThrow();
  });

  test("rejects short idempotency keys and unschedulable media types", () => {
    const base = {
      name: "x",
      audience: { contactIds: [crypto.randomUUID()], tagIds: [] },
      content: "hello",
      scheduledAt: new Date().toISOString(),
      audienceHash: "h".repeat(10),
    };
    expect(() =>
      createBulkJobSchema.parse({ ...base, idempotencyKey: "short" }),
    ).toThrow();
    expect(() =>
      createBulkJobSchema.parse({
        ...base,
        idempotencyKey: crypto.randomUUID(),
        messageType: "audio",
      }),
    ).toThrow();
  });
});
