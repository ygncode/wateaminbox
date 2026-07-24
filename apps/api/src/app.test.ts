import { describe, expect, test } from "bun:test";
import { app } from "./app.js";

describe("CORS", () => {
  test("allows the Pusher socket header for action requests", async () => {
    const response = await app.request("/api/actions/messages/typing", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:4444",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,content-type,x-company-id,x-pusher-socket-id",
      },
    });

    expect(response.status).toBe(204);
    const allowedHeaders =
      response.headers.get("Access-Control-Allow-Headers")?.toLowerCase() ?? "";
    expect(allowedHeaders.split(",").map((header) => header.trim())).toContain(
      "x-pusher-socket-id",
    );
  });
});
