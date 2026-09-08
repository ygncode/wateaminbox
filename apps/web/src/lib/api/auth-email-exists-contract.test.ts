import { describe, expect, test } from "bun:test";
import { ApiRequestError, handleResponse } from "./client.js";

/**
 * The AccountSettings toast reads `error.message` (AccountSettings.tsx:170-174:
 * `toast.error(error instanceof Error ? error.message : ...)`). `updateProfile`
 * rejects with the `ApiRequestError` that `handleResponse` builds from the HTTP
 * response body. This pins the chain the UI relies on: a 409 EMAIL_EXISTS
 * surfaces the friendly message; a pre-fix 500 surfaces the generic one.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("handleResponse — EMAIL_EXISTS surfacing the route contract to the UI", () => {
  test("a 409 EMAIL_EXISTS with a message becomes an ApiRequestError carrying that message", async () => {
    const response = jsonResponse(409, {
      error: "EMAIL_EXISTS",
      message: "An account with this email already exists",
    });

    let thrown: unknown;
    try {
      await handleResponse(response);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiRequestError);
    const apiError = thrown as ApiRequestError;
    expect(apiError.statusCode).toBe(409);
    expect(apiError.code).toBe("EMAIL_EXISTS");
    // This is the string the toast renders — the friendly contract, not a
    // generic "Internal server error".
    expect(apiError.message).toBe("An account with this email already exists");
  });

  test("the pre-fix 500 Internal server error surfaces a generic message, not the email one", async () => {
    // The shape the route produced before the fix: HTTP 500 { error: "Internal server error" }
    // with no `message` field, so handleResponse falls back to response.statusText.
    const response = new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      },
    );

    let thrown: unknown;
    try {
      await handleResponse(response);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiRequestError);
    const apiError = thrown as ApiRequestError;
    expect(apiError.statusCode).toBe(500);
    // The generic fallback, NOT "An account with this email already exists".
    expect(apiError.message).not.toBe(
      "An account with this email already exists",
    );
    expect(apiError.code).toBe("Internal server error");
  });
});
