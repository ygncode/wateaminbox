import { describe, expect, test } from "bun:test";
import { classifyTelegramSendFailure } from "./transport";

describe("Telegram send outcome classification", () => {
  test("does not retry an ambiguous transport outcome", () => {
    expect(
      classifyTelegramSendFailure(new Error("Telegram Bot API is unavailable")),
    ).toEqual({
      outcome: "uncertain",
      errorCode: "telegram_send_outcome_unknown",
    });
  });

  test("treats an explicit provider rejection as permanent", () => {
    expect(
      classifyTelegramSendFailure(
        new Error("Telegram Bot API rejected the request"),
      ),
    ).toEqual({
      outcome: "permanent_failure",
      errorCode: "telegram_request_rejected",
    });
  });
});
