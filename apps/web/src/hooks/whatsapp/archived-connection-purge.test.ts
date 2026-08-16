import { describe, expect, test } from "bun:test";
import { ApiRequestError } from "@/lib/api/client";
import {
  purgeErrorNeedsRefetch,
  resolvePurgeErrorMessage,
} from "./useArchivedWhatsAppConnections";

describe("archived connection purge feedback", () => {
  test("states the reason the API gave for refusing the delete", () => {
    expect(
      resolvePurgeErrorMessage(
        new ApiRequestError(
          409,
          "CONFLICT",
          "Archive this connection before permanently deleting its inbox data",
        ),
      ),
    ).toBe(
      "Archive this connection before permanently deleting its inbox data",
    );
  });

  test("falls back to a plain explanation for an unlabeled failure", () => {
    expect(resolvePurgeErrorMessage(new Error(""))).toBe(
      "Could not permanently delete this connection",
    );
    expect(resolvePurgeErrorMessage("network down")).toBe(
      "Could not permanently delete this connection",
    );
  });

  test("refetches the archived list when the server says the row is stale", () => {
    expect(
      purgeErrorNeedsRefetch(
        new ApiRequestError(409, "CONFLICT", "Archive it first"),
      ),
    ).toBe(true);
    expect(
      purgeErrorNeedsRefetch(new ApiRequestError(404, "NOT_FOUND", "Gone")),
    ).toBe(true);
  });

  test("leaves the list alone when the delete failed for a server-side reason", () => {
    expect(
      purgeErrorNeedsRefetch(
        new ApiRequestError(500, "UNKNOWN_ERROR", "Internal Server Error"),
      ),
    ).toBe(false);
    expect(purgeErrorNeedsRefetch(new Error("offline"))).toBe(false);
  });
});
