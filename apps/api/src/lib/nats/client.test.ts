import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  API_EVENTS_CONSUMER,
  API_EVENTS_DELIVER_SUBJECT,
  API_EVENTS_QUEUE,
  buildEventConsumerOptions,
  parseWhatsAppEvent,
  PermanentEventError,
} from "./client.js";

describe("durable API event consumer", () => {
  test("retains offline events and acknowledges explicitly", () => {
    const subject = "WHATSAPP.events.>";
    const builder = buildEventConsumerOptions(subject) as unknown as {
      getOpts(): {
        config: {
          durable_name?: string;
          deliver_subject?: string;
          deliver_group?: string;
          deliver_policy?: string;
          ack_policy?: string;
          filter_subject?: string;
          max_deliver?: number;
        };
        mack: boolean;
      };
    };
    const options = builder.getOpts();

    expect(options.config.durable_name).toBe(API_EVENTS_CONSUMER);
    expect(options.config.deliver_subject).toBe(API_EVENTS_DELIVER_SUBJECT);
    expect(options.config.deliver_group).toBe(API_EVENTS_QUEUE);
    expect(options.config.deliver_policy).toBe("all");
    expect(options.config.ack_policy).toBe("explicit");
    expect(options.config.filter_subject).toBe(subject);
    expect(options.config.max_deliver).toBe(10);
    expect(options.mack).toBe(true);
  });

  test("validates the shared versioned event fixture at runtime", () => {
    const fixtureUrl = new URL(
      "../../../../../services/shared/nats/testdata/message-event-v1.json",
      import.meta.url,
    );
    const event = parseWhatsAppEvent(
      JSON.parse(readFileSync(fixtureUrl, "utf8")),
    );
    expect(event.type).toBe("message");
    expect(() =>
      parseWhatsAppEvent({ type: "message", payload: {} }),
    ).toThrow();
  });

  test("accepts pre-versioning worker envelopes during rolling upgrades", () => {
    const event = parseWhatsAppEvent({
      type: "message",
      companyId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      payload: { messageId: "legacy-worker-message" },
      timestamp: new Date().toISOString(),
    });
    expect(event.contractVersion).toBe(1);
  });

  test("marks terminal handler validation failures for immediate dead-lettering", () => {
    const error = new PermanentEventError("unknown connection");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PermanentEventError");
  });
});
