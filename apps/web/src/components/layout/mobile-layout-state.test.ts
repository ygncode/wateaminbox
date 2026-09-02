import { describe, expect, it } from "bun:test";
import { resolveMobileView } from "./mobile-layout-state";

describe("resolveMobileView", () => {
  it("shows the list whenever the route has no selected conversation", () => {
    expect(resolveMobileView(undefined)).toBe("chat-list");
    expect(resolveMobileView(null)).toBe("chat-list");
  });

  it("shows the thread whenever the route selects a conversation", () => {
    expect(resolveMobileView("contact-1")).toBe("message-thread");
  });
});
