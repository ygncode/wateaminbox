import { describe, expect, test } from "bun:test";
import { ChannelCredentialKeyError } from "../../../services/channel-credential.service";
import { classifyTelegramSendFailure } from "./transport";

describe("Telegram send outcome classification", () => {
  test("fails a missing credential key outright instead of calling it unknown", () => {
    // The stored credential is intact and Telegram is fine; this process was
    // started without the key that opens it, so the send certainly never
    // happened. Calling that uncertain parks the intent for ever, because an
    // uncertain outcome is deliberately never retried - and it hides an
    // operator-fixable fault behind the label for "we could not tell".
    expect(
      classifyTelegramSendFailure(
        new ChannelCredentialKeyError(
          "active channel credential key is unavailable",
        ),
      ),
    ).toEqual({
      outcome: "permanent_failure",
      errorCode: "telegram_credential_key_unavailable",
    });
  });

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
