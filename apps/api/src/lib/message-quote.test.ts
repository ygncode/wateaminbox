import { expect, test } from "bun:test";
import { isConfirmedQuote } from "./message-quote.js";

test("rejects temporary stanzas and uncertain outgoing messages", () => {
  expect(
    isConfirmedQuote({
      message_id: "pending_123",
      from_me: true,
      status: "sent",
    }),
  ).toBe(false);
  expect(
    isConfirmedQuote({
      message_id: "stable-wa-id",
      from_me: true,
      status: "pending",
    }),
  ).toBe(false);
  expect(
    isConfirmedQuote({
      message_id: "stable-wa-id",
      from_me: true,
      status: "failed",
    }),
  ).toBe(false);
  expect(
    isConfirmedQuote({ message_id: null, from_me: false, status: "delivered" }),
  ).toBe(false);
});
test("allows confirmed outgoing and stored incoming stanzas", () => {
  for (const status of ["sent", "delivered", "read"]) {
    expect(
      isConfirmedQuote({ message_id: "stable-wa-id", from_me: true, status }),
    ).toBe(true);
  }
  expect(
    isConfirmedQuote({
      message_id: "incoming-wa-id",
      from_me: false,
      status: null,
    }),
  ).toBe(true);
});
