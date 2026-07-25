import { describe, expect, test } from "bun:test";
import { normalizeWorkerErrorToast } from "./toast-notification.service.js";

describe("worker toast normalization", () => {
  test("does not pass arbitrary worker fields through", () => {
    expect(
      normalizeWorkerErrorToast(
        { error: "failed", secret: "hidden" },
        "connection",
      ),
    ).toEqual({
      type: "error",
      title: "WhatsApp action failed",
      message: "failed",
      connectionId: "connection",
    });
  });
});
