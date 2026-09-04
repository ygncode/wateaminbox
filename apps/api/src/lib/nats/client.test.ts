import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  API_CRITICAL_EVENT_FILTER_SUBJECTS,
  API_CRITICAL_EVENTS_CONSUMER,
  API_CRITICAL_EVENTS_DELIVER_SUBJECT,
  API_CRITICAL_EVENTS_QUEUE,
  API_CRITICAL_EVENTS_TUNING,
  API_EVENTS_CONSUMER,
  API_EVENTS_DELIVER_SUBJECT,
  API_EVENTS_QUEUE,
  API_HISTORY_EVENT_FILTER_SUBJECTS,
  API_HISTORY_EVENTS_CONSUMER,
  API_HISTORY_EVENTS_DELIVER_SUBJECT,
  API_HISTORY_EVENTS_QUEUE,
  API_HISTORY_EVENTS_TUNING,
  API_TRANSIENT_EVENT_FILTER_SUBJECTS,
  API_TRANSIENT_EVENTS_CONSUMER,
  API_TRANSIENT_EVENTS_DELIVER_SUBJECT,
  API_TRANSIENT_EVENTS_QUEUE,
  API_TRANSIENT_EVENTS_TUNING,
  buildEventConsumerOptions,
  buildSendReactionCommand,
  PermanentEventError,
  parseWhatsAppEvent,
} from "./client.js";

interface InspectableConsumerOpts {
  getOpts(): {
    config: {
      durable_name?: string;
      deliver_subject?: string;
      deliver_group?: string;
      deliver_policy?: string;
      ack_policy?: string;
      filter_subject?: string;
      filter_subjects?: string[];
      max_deliver?: number;
      max_ack_pending?: number;
      ack_wait?: number;
    };
    mack: boolean;
  };
}

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

  test("accepts durable on-demand history page events", () => {
    const event = parseWhatsAppEvent({
      contractVersion: 1,
      type: "history_sync_page",
      companyId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      payload: {
        chatJid: "15551234567@s.whatsapp.net",
        messageCount: 50,
        status: "available",
      },
      timestamp: new Date().toISOString(),
    });
    expect(event.type).toBe("history_sync_page");
  });

  test("accepts paired lifecycle events", () => {
    const event = parseWhatsAppEvent({
      contractVersion: 1,
      type: "paired",
      companyId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      payload: {
        phoneNumber: "15551234567",
        jid: "15551234567@s.whatsapp.net",
      },
      timestamp: new Date().toISOString(),
    });
    expect(event.type).toBe("paired");
  });

  /**
   * The worker publishes `logged_out` as its own event type when WhatsApp
   * unlinks the device (`PublishConnectionStatus` in the Go worker sets
   * `Type: status`). It was absent from this enum, so the envelope failed to
   * parse and the consumer terminated and dead-lettered the message — the one
   * disconnect that can never heal on its own was also the one the API never
   * saw.
   */
  test("accepts logout events published by the worker", () => {
    const event = parseWhatsAppEvent({
      contractVersion: 1,
      type: "logged_out",
      companyId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      payload: { reason: "device_removed" },
      timestamp: new Date().toISOString(),
    });
    expect(event.type).toBe("logged_out");
  });

  test("marks terminal handler validation failures for immediate dead-lettering", () => {
    const error = new PermanentEventError("unknown connection");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PermanentEventError");
  });

  test("passing an array of subjects accumulates filter_subjects (plural), not filter_subject", () => {
    const builder = buildEventConsumerOptions([
      "WHATSAPP.events.*.*.presence",
      "WHATSAPP.events.*.*.typing",
    ]) as unknown as InspectableConsumerOpts;
    const options = builder.getOpts();

    expect(options.config.filter_subject).toBeUndefined();
    expect(options.config.filter_subjects).toEqual([
      "WHATSAPP.events.*.*.presence",
      "WHATSAPP.events.*.*.typing",
    ]);
  });

  test("a custom identity/tuning overrides the legacy defaults", () => {
    const builder = buildEventConsumerOptions(
      API_TRANSIENT_EVENT_FILTER_SUBJECTS,
      {
        durable: API_TRANSIENT_EVENTS_CONSUMER,
        deliverSubject: API_TRANSIENT_EVENTS_DELIVER_SUBJECT,
        queue: API_TRANSIENT_EVENTS_QUEUE,
      },
      API_TRANSIENT_EVENTS_TUNING,
    ) as unknown as InspectableConsumerOpts;
    const options = builder.getOpts();

    expect(options.config.durable_name).toBe(API_TRANSIENT_EVENTS_CONSUMER);
    expect(options.config.deliver_subject).toBe(
      API_TRANSIENT_EVENTS_DELIVER_SUBJECT,
    );
    expect(options.config.deliver_group).toBe(API_TRANSIENT_EVENTS_QUEUE);
    expect(options.config.max_deliver).toBe(5);
    expect(options.config.max_ack_pending).toBe(1024);
    expect(options.config.deliver_policy).toBe("new");
    // nats.js stores ack_wait internally in nanoseconds.
    expect(options.config.ack_wait).toBe(30_000 * 1_000_000);
  });
});

/**
 * Pins the critical/history/transient consumer identities, filters, and
 * tuning against the values in services/shared/nats/consumers.go
 * (APICriticalEventsConsumerConfig / APITransientEventsConsumerConfig).
 * nats.js only binds to an existing durable when the filter subjects and
 * queue group match, so a silent edit on either side would leave the API
 * unable to subscribe (or attach to the wrong consumer) - same rationale as
 * the legacy TestAPIEventsConsumerConfigMatchesAPIClient pin on the Go side.
 */
describe("critical/history/transient event consumer split", () => {
  test("event lane identities are disjoint from each other and from the legacy consumer", () => {
    const durables = [
      API_EVENTS_CONSUMER,
      API_CRITICAL_EVENTS_CONSUMER,
      API_HISTORY_EVENTS_CONSUMER,
      API_TRANSIENT_EVENTS_CONSUMER,
    ];
    expect(new Set(durables).size).toBe(durables.length);

    const deliverSubjects = [
      API_EVENTS_DELIVER_SUBJECT,
      API_CRITICAL_EVENTS_DELIVER_SUBJECT,
      API_HISTORY_EVENTS_DELIVER_SUBJECT,
      API_TRANSIENT_EVENTS_DELIVER_SUBJECT,
    ];
    expect(new Set(deliverSubjects).size).toBe(deliverSubjects.length);
  });

  test("filter subject lists are non-overlapping and every type appears in exactly one list", () => {
    const critical = new Set(API_CRITICAL_EVENT_FILTER_SUBJECTS);
    const history = new Set(API_HISTORY_EVENT_FILTER_SUBJECTS);
    const transient = new Set(API_TRANSIENT_EVENT_FILTER_SUBJECTS);

    expect(critical.size).toBe(API_CRITICAL_EVENT_FILTER_SUBJECTS.length);
    expect(history.size).toBe(API_HISTORY_EVENT_FILTER_SUBJECTS.length);
    expect(transient.size).toBe(API_TRANSIENT_EVENT_FILTER_SUBJECTS.length);
    const allSubjects = [...critical, ...history, ...transient];
    expect(new Set(allSubjects).size).toBe(allSubjects.length);
  });

  test("history filter contains reconnect messages and contact-sync events", () => {
    expect(API_HISTORY_EVENT_FILTER_SUBJECTS).toEqual([
      "WHATSAPP.events.*.*.history_message",
      "WHATSAPP.events.*.*.history_contact",
    ]);
  });

  test("history consumer identity matches consumers.go APIHistoryEventsConsumerConfig", () => {
    expect(API_HISTORY_EVENTS_CONSUMER).toBe("whatsapp-api-history-events-v1");
    expect(API_HISTORY_EVENTS_DELIVER_SUBJECT).toBe(
      "WHATSAPP.api.history-events.delivery",
    );
    expect(API_HISTORY_EVENTS_QUEUE).toBe("whatsapp-api-history-events");
    expect(API_HISTORY_EVENTS_TUNING).toEqual({
      ackWaitMs: 120_000,
      maxDeliver: 10,
      maxAckPending: 64,
      deliverPolicy: "new",
    });
  });

  test("history consumer options bind the dedicated durable", () => {
    const builder = buildEventConsumerOptions(
      API_HISTORY_EVENT_FILTER_SUBJECTS,
      {
        durable: API_HISTORY_EVENTS_CONSUMER,
        deliverSubject: API_HISTORY_EVENTS_DELIVER_SUBJECT,
        queue: API_HISTORY_EVENTS_QUEUE,
      },
      API_HISTORY_EVENTS_TUNING,
    ) as unknown as InspectableConsumerOpts;
    const options = builder.getOpts();
    expect(options.config.durable_name).toBe(API_HISTORY_EVENTS_CONSUMER);
    expect(options.config.filter_subject).toBeUndefined();
    expect(options.config.filter_subjects).toEqual([
      "WHATSAPP.events.*.*.history_message",
      "WHATSAPP.events.*.*.history_contact",
    ]);
    expect(options.config.max_ack_pending).toBe(64);
    expect(options.config.ack_wait).toBe(120_000 * 1_000_000);
  });

  test("all lane subject lists are non-overlapping", () => {
    const seen = new Set<string>();
    for (const subject of [
      ...API_CRITICAL_EVENT_FILTER_SUBJECTS,
      ...API_HISTORY_EVENT_FILTER_SUBJECTS,
      ...API_TRANSIENT_EVENT_FILTER_SUBJECTS,
    ]) {
      expect(seen.has(subject)).toBe(false);
      seen.add(subject);
    }
  });

  test("transient filter subjects are exactly presence and typing", () => {
    expect(API_TRANSIENT_EVENT_FILTER_SUBJECTS).toEqual([
      "WHATSAPP.events.*.*.presence",
      "WHATSAPP.events.*.*.typing",
    ]);
  });

  test("critical consumer identity matches consumers.go APICriticalEventsConsumerConfig", () => {
    expect(API_CRITICAL_EVENTS_CONSUMER).toBe(
      "whatsapp-api-critical-events-v1",
    );
    expect(API_CRITICAL_EVENTS_DELIVER_SUBJECT).toBe(
      "WHATSAPP.api.critical-events.delivery",
    );
    expect(API_CRITICAL_EVENTS_QUEUE).toBe("whatsapp-api-critical-events");
    expect(API_CRITICAL_EVENTS_TUNING).toEqual({
      ackWaitMs: 60_000,
      maxDeliver: 10,
      maxAckPending: 128,
      deliverPolicy: "new",
    });
  });

  test("transient consumer identity matches consumers.go APITransientEventsConsumerConfig", () => {
    expect(API_TRANSIENT_EVENTS_CONSUMER).toBe(
      "whatsapp-api-transient-events-v1",
    );
    expect(API_TRANSIENT_EVENTS_DELIVER_SUBJECT).toBe(
      "WHATSAPP.api.transient-events.delivery",
    );
    expect(API_TRANSIENT_EVENTS_QUEUE).toBe("whatsapp-api-transient-events");
    expect(API_TRANSIENT_EVENTS_TUNING).toEqual({
      ackWaitMs: 30_000,
      maxDeliver: 5,
      maxAckPending: 1024,
      deliverPolicy: "new",
    });
  });

  test("the legacy consumer's blanket filter still covers every critical and transient subject (interest-retention safety net during cutover)", () => {
    // Mirrors subjectMatches in services/shared/nats/consumers_test.go: "*"
    // matches exactly one token, ">" matches one-or-more trailing tokens.
    const subjectMatches = (filter: string, subject: string): boolean => {
      const filterTokens = filter.split(".");
      const subjectTokens = subject.split(".");
      for (let i = 0; i < filterTokens.length; i++) {
        const token = filterTokens[i];
        if (token === ">") return i < subjectTokens.length;
        if (i >= subjectTokens.length) return false;
        if (token !== "*" && token !== subjectTokens[i]) return false;
      }
      return filterTokens.length === subjectTokens.length;
    };
    const concreteExample = (wildcarded: string): string =>
      wildcarded.replace("*", "company-1").replace("*", "connection-1");

    for (const subject of [
      ...API_CRITICAL_EVENT_FILTER_SUBJECTS,
      ...API_HISTORY_EVENT_FILTER_SUBJECTS,
      ...API_TRANSIENT_EVENT_FILTER_SUBJECTS,
    ]) {
      expect(
        subjectMatches("WHATSAPP.events.>", concreteExample(subject)),
      ).toBe(true);
    }
  });
});

describe("reaction command", () => {
  test("carries the target sender needed for group message keys", () => {
    const command = buildSendReactionCommand(
      "connection-1",
      "120363123456789012@g.us",
      "3EB0GROUPMESSAGE",
      "👍",
      "user-1",
      false,
      "15551234567@s.whatsapp.net",
    );

    expect(command).toMatchObject({
      connection_id: "connection-1",
      to: "120363123456789012@g.us",
      type: "reaction",
      target_message_id: "3EB0GROUPMESSAGE",
      target_sender_jid: "15551234567@s.whatsapp.net",
      from_me: false,
    });
  });

  test("preserves an empty emoji when removing a group reaction", () => {
    const command = buildSendReactionCommand(
      "connection-1",
      "120363123456789012@g.us",
      "3EB0GROUPMESSAGE",
      "",
      "user-1",
      false,
      "48954691608613@lid",
    );

    expect(command).toMatchObject({
      emoji: "",
      target_message_id: "3EB0GROUPMESSAGE",
      target_sender_jid: "48954691608613@lid",
      from_me: false,
    });
  });
});
