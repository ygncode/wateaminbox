import { afterEach, describe, expect, test } from "bun:test";
import {
  getCustomerChats,
  getMergeHistory,
  getMergeSuggestions,
} from "./contacts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * The envelope contract for the merge surfaces.
 *
 * `handleResponse` already unwraps a lone `{ data }` field, so a caller that
 * reads `.data` again receives `undefined` and falls back to an empty list.
 * Every one of these surfaces renders nothing when its list is empty, which is
 * indistinguishable from "this customer has nothing to show" - the chat
 * switcher and the merge history both silently disappeared that way, with the
 * API answering 200 and the correct rows the whole time.
 */
describe("contact merge API contracts", () => {
  test("reads the customer's chats from the unwrapped payload", async () => {
    globalThis.fetch = (async (_input) =>
      Response.json({
        data: {
          chats: [
            { chatId: "chat-1", channel: "telegram" },
            { chatId: "chat-2", channel: "whatsapp" },
          ],
        },
      })) as typeof fetch;

    const chats = await getCustomerChats("contact-1");
    expect(chats.map((chat) => chat.chatId)).toEqual(["chat-1", "chat-2"]);
  });

  test("reads merge history from the unwrapped payload", async () => {
    globalThis.fetch = (async (_input) =>
      Response.json({
        data: {
          merges: [{ mergeEventId: "merge-1", sourceName: "Ada" }],
        },
      })) as typeof fetch;

    const merges = await getMergeHistory("contact-1");
    expect(merges.map((entry) => entry.mergeEventId)).toEqual(["merge-1"]);
  });

  test("reads merge suggestions from the unwrapped payload", async () => {
    globalThis.fetch = (async (_input) =>
      Response.json({
        data: [{ contactId: "contact-2", matchedAddress: "60123456789" }],
      })) as typeof fetch;

    const suggestions = await getMergeSuggestions("contact-1");
    expect(suggestions.map((entry) => entry.contactId)).toEqual(["contact-2"]);
  });

  test("still answers with an empty list when the payload carries none", async () => {
    globalThis.fetch = (async (_input) =>
      Response.json({ data: { chats: [] } })) as typeof fetch;

    expect(await getCustomerChats("contact-1")).toEqual([]);
  });
});
