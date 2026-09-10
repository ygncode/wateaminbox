import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  ContactBlockedError,
  isUniqueViolation,
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

describe("isUniqueViolation", () => {
  // Kysely's PostgresDialect rethrows the underlying node-postgres error
  // verbatim, so the catch site sees exactly the driver's shape.
  const pg23505 = (constraint?: string) =>
    Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      ...(constraint ? { constraint } : {}),
    });

  test("matches a Postgres 23505 with no constraint filter", () => {
    expect(isUniqueViolation(pg23505("users_email_key"))).toBe(true);
    expect(isUniqueViolation(pg23505())).toBe(true);
  });

  test("narrows to a named constraint", () => {
    expect(
      isUniqueViolation(pg23505("users_email_key"), "users_email_key"),
    ).toBe(true);
    expect(
      isUniqueViolation(
        pg23505("auth_tokens_token_hash_key"),
        "users_email_key",
      ),
    ).toBe(false);
  });

  test("ignores unrelated error codes and non-errors", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // foreign_key_violation
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  test("with a constraint does not match a 23505 missing the field", () => {
    expect(isUniqueViolation(pg23505(), "users_email_key")).toBe(false);
  });
});
