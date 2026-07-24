import { describe, expect, test } from "bun:test";
import {
  API_EVENTS_CONSUMER,
  API_EVENTS_DELIVER_SUBJECT,
  API_EVENTS_QUEUE,
  buildEventConsumerOptions,
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
});
