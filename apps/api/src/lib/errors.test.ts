import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  ContactBlockedError,
  NoActiveCaseError,
} from "./errors.js";

describe("ContactBlockedError", () => {
  test("is a 409 conflict, like the other send-invariant state errors", () => {
    const error = new ContactBlockedError();

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
    // app.ts's onError branches on `instanceof AppError` and serializes
    // `statusCode`/`message`, so the name is what callers (and the
    // scheduled-dispatch permanent-failure branch) match on.
    expect(error.name).toBe("ContactBlockedError");
    expect(new NoActiveCaseError().name).toBe("NoActiveCaseError");
  });

  test("tells the operator how to clear the state rather than just naming it", () => {
    expect(new ContactBlockedError().message).toContain("unblock");
  });
});
