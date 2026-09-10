import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Message } from "@wateaminbox/shared";
import {
  addMessageToCache,
  type InfiniteMessageData,
} from "../../contexts/realtime/cache-utils";
import { setCompanyId } from "../../lib/api/client";
import {
  infiniteMessageKeys,
  selectInfiniteMessages,
} from "../useInfiniteMessages";
import {
  createOptimisticMessage,
  isOptimisticTwin,
  prependOptimisticMessage,
  reconcileOptimisticMessage,
} from "./optimistic-message";
import type { InfiniteMessagesData, SendMessageInput } from "./types";

const CONTACT_ID = "contact-1";
const COMPANY_ID = "company-a";

const SENDER = { id: "user-1", name: "Sender One" };

function existingMessage(content: string, id = `existing-${content}`): Message {
  return {
    id,
    conversationId: CONTACT_ID,
    senderId: CONTACT_ID,
    senderType: "contact",
    messageType: "text",
    content,
    isStarred: false,
    isDeleted: false,
    status: "delivered",
    createdAt: new Date("2026-09-08T10:00:00.000Z"),
    updatedAt: new Date("2026-09-08T10:00:00.000Z"),
  } as Message;
}

function sendInput(content: string): SendMessageInput {
  return {
    contactId: CONTACT_ID,
    content,
    messageType: "text",
  };
}

/** Build the confirmed realtime echo: different id (server uuid), server status. */
function confirmedOf(
  optimistic: Message,
  overrides: Partial<Message> = {},
): Message {
  return {
    ...optimistic,
    id: "server-uuid",
    status: "sent",
    ...overrides,
  } as Message;
}

/**
 * Seed the infinite-query cache for one conversation; return the cache key.
 * The cache is stored as `InfiniteMessageData` (the `select` input type).
 */
function seedClient(
  client: QueryClient,
  initialMessages: Message[] = [existingMessage("before")],
): ReturnType<typeof infiniteMessageKeys.list> {
  setCompanyId(COMPANY_ID);
  const key = infiniteMessageKeys.list(CONTACT_ID);
  client.setQueryData<InfiniteMessageData>(key, {
    pages: [
      {
        messages: initialMessages,
        hasMore: false,
        remoteHistoryStatus: "unknown",
      },
    ],
    pageParams: [undefined],
  });
  return key;
}

/**
 * Simulate `useSendMessage.onMutate`: prepend the optimistic placeholder into
 * the cache using the real `prependOptimisticMessage` helper. The cache stores
 * `InfiniteMessageData` while `prependOptimisticMessage` operates on
 * `InfiniteMessagesData`; the shapes are runtime-compatible and bridged here.
 */
function prependOptimistic(
  client: QueryClient,
  key: ReturnType<typeof infiniteMessageKeys.list>,
  optimistic: Message,
): void {
  const current = client.getQueryData<InfiniteMessageData>(key);
  const next = prependOptimisticMessage(
    current as unknown as InfiniteMessagesData,
    optimistic,
  );
  client.setQueryData<InfiniteMessageData>(
    key,
    next as unknown as InfiniteMessageData,
  );
}

/**
 * Simulate `useSendMessage.onSuccess`: call the real `reconcileOptimisticMessage`
 * on the cache (POST onSuccess backstop).
 */
function reconcileInCache(
  client: QueryClient,
  key: ReturnType<typeof infiniteMessageKeys.list>,
  optimisticId: string,
  confirmed: Message,
): void {
  const current = client.getQueryData<InfiniteMessageData>(key);
  const next = reconcileOptimisticMessage(
    current as unknown as InfiniteMessagesData,
    optimisticId,
    confirmed,
  );
  client.setQueryData<InfiniteMessageData>(
    key,
    next as unknown as InfiniteMessageData,
  );
}

/** Read the cache for the selector; throw if not seeded. */
function readForSelector(
  client: QueryClient,
  key: ReturnType<typeof infiniteMessageKeys.list>,
): InfiniteMessageData {
  const data = client.getQueryData<InfiniteMessageData>(key);
  if (!data) throw new Error("cache not seeded");
  return data;
}

describe("optimistic + realtime race (real selector)", () => {
  test("realtime echo of own send, arriving before POST onSuccess, is rendered as a single row", () => {
    const client = new QueryClient();
    const key = seedClient(client);

    // 1. User sends: optimistic placeholder is prepended (useSendMessage.onMutate).
    const optimistic = createOptimisticMessage(sendInput("hello"), SENDER);
    prependOptimistic(client, key, optimistic);
    expect(
      selectInfiniteMessages(readForSelector(client, key)).messages.filter(
        (m) => m.content === "hello",
      ),
    ).toHaveLength(1);

    // 2. Realtime `message:new` echo arrives BEFORE POST onSuccess. The echo
    //    has a different id (server uuid) than the optimistic placeholder.
    const confirmed = confirmedOf(optimistic);
    const result = addMessageToCache(client, CONTACT_ID, confirmed);

    // The fix replaces the placeholder in place rather than prepending a
    // second row: one row for this send, with the confirmed id.
    expect(result.added).toBe(true);
    expect(result.isDuplicate).toBe(false);

    const messages = selectInfiniteMessages(
      readForSelector(client, key),
    ).messages;
    const hello = messages.filter((m) => m.content === "hello");
    expect(hello).toHaveLength(1);
    expect(hello[0].id).toBe("server-uuid");
    // The optimistic id is no longer rendered.
    expect(messages.some((m) => m.id === optimistic.id)).toBe(false);

    // 3. POST onSuccess now runs as a backstop; the confirmation already
    //    arrived so reconcileOptimisticMessage should be a no-op (the
    //    optimistic id has already been replaced).
    reconcileInCache(client, key, optimistic.id, confirmed);
    const afterPost = selectInfiniteMessages(
      readForSelector(client, key),
    ).messages;
    expect(afterPost.filter((m) => m.content === "hello")).toHaveLength(1);
    expect(afterPost.find((m) => m.content === "hello")?.id).toBe(
      "server-uuid",
    );
  });

  test("realtime echo whose createdAt is an ISO string (runtime JSON shape) still reconciles", () => {
    const client = new QueryClient();
    const key = seedClient(client);

    const optimistic = createOptimisticMessage(sendInput("hello"), SENDER);
    prependOptimistic(client, key, optimistic);

    // Realtime payloads deserialize `createdAt` as an ISO string (JSON has no
    // Date), while the optimistic placeholder stores a `Date` object. The twin
    // match must bridge the runtime/type mismatch.
    const confirmed = confirmedOf(optimistic, {
      createdAt: optimistic.createdAt.toISOString() as unknown as Date,
    });
    const result = addMessageToCache(client, CONTACT_ID, confirmed);
    expect(result.added).toBe(true);

    const hello = selectInfiniteMessages(
      readForSelector(client, key),
    ).messages.filter((m) => m.content === "hello");
    expect(hello).toHaveLength(1);
    expect(hello[0].id).toBe("server-uuid");
  });

  test("reconciles the placeholder even when it lives in a later page", () => {
    const client = new QueryClient();
    const key = seedClient(client, [existingMessage("page0")]);

    const optimistic = createOptimisticMessage(sendInput("hello"), SENDER);
    // Place the placeholder into page index 1 (a refetched/older page) instead
    // of the head page, to exercise the per-page scan.
    client.setQueryData<InfiniteMessageData>(key, {
      pages: [
        client.getQueryData<InfiniteMessageData>(key)!.pages[0],
        {
          messages: [optimistic],
          hasMore: false,
          remoteHistoryStatus: "unknown",
        },
      ],
      pageParams: [undefined, "cursor-1"],
    });

    const confirmed = confirmedOf(optimistic);
    const result = addMessageToCache(client, CONTACT_ID, confirmed);
    expect(result.added).toBe(true);

    const updated = client.getQueryData<InfiniteMessageData>(key)!;
    expect(
      selectInfiniteMessages(updated).messages.filter(
        (m) => m.content === "hello",
      ),
    ).toHaveLength(1);
    expect(
      selectInfiniteMessages(updated).messages.find(
        (m) => m.content === "hello",
      )?.id,
    ).toBe("server-uuid");
    // Page 1 has exactly one message (confirmed in place of the placeholder),
    // not two (placeholder + confirmed).
    expect(updated.pages[1].messages).toHaveLength(1);
    expect(updated.pages[1].messages[0].id).toBe("server-uuid");
  });

  test("non-matching realtime messages are still prepended (no inbound regression)", () => {
    const client = new QueryClient();
    const key = seedClient(client);

    // A realtime message from a contact (no optimistic twin) must still be
    // prepended; the dedup fix must not regress the inbound path.
    const inbound = {
      id: "inbound-uuid",
      conversationId: CONTACT_ID,
      senderId: CONTACT_ID,
      senderType: "contact",
      messageType: "text",
      content: "hi from contact",
      status: "delivered",
      isStarred: false,
      isDeleted: false,
      createdAt: new Date("2026-09-08T11:00:00.000Z"),
      updatedAt: new Date("2026-09-08T11:00:00.000Z"),
    } as Message;
    const result = addMessageToCache(client, CONTACT_ID, inbound);
    expect(result.added).toBe(true);
    expect(result.isDuplicate).toBe(false);

    expect(
      selectInfiniteMessages(readForSelector(client, key)).messages.find(
        (m) => m.id === "inbound-uuid",
      ),
    ).toBeDefined();
  });

  test("POST onSuccess still collapses the optimistic placeholder when the echo arrives after the POST response", () => {
    // The opposite ordering branch: POST response wins, so the realtime
    // echo arrives after reconcileOptimisticMessage has already replaced the
    // placeholder. The later echo must then be dropped by id-only dedup.
    const client = new QueryClient();
    const key = seedClient(client);

    const optimistic = createOptimisticMessage(sendInput("hello"), SENDER);
    prependOptimistic(client, key, optimistic);

    const confirmed = confirmedOf(optimistic);

    // POST onSuccess first: replaces the optimistic placeholder in place.
    reconcileInCache(client, key, optimistic.id, confirmed);
    expect(
      selectInfiniteMessages(readForSelector(client, key)).messages.filter(
        (m) => m.content === "hello",
      ),
    ).toHaveLength(1);

    // Realtime echo arrives after; same id, so id-only dedup drops it.
    const echoResult = addMessageToCache(client, CONTACT_ID, confirmed);
    expect(echoResult.isDuplicate).toBe(true);
    expect(echoResult.added).toBe(false);
    expect(
      selectInfiniteMessages(readForSelector(client, key)).messages.filter(
        (m) => m.content === "hello",
      ),
    ).toHaveLength(1);
  });
});

describe("isOptimisticTwin", () => {
  test("matches a placeholder with same sender, content, and type within the window", () => {
    const optimistic = createOptimisticMessage(sendInput("hi"), SENDER);
    const confirmed = confirmedOf(optimistic);
    expect(isOptimisticTwin(optimistic, confirmed)).toBe(true);
  });

  test("matches across the runtime Date/ISO-string createdAt mismatch", () => {
    const optimistic = createOptimisticMessage(sendInput("hi"), SENDER);
    const confirmed = confirmedOf(optimistic, {
      createdAt: optimistic.createdAt.toISOString() as unknown as Date,
    });
    expect(isOptimisticTwin(optimistic, confirmed)).toBe(true);
  });

  test("does not match when sender differs", () => {
    const optimistic = createOptimisticMessage(sendInput("hi"), SENDER);
    const confirmed = confirmedOf(optimistic, { senderId: "other-user" });
    expect(isOptimisticTwin(optimistic, confirmed)).toBe(false);
  });

  test("does not match when the createdAt window exceeds 30s", () => {
    const optimistic = createOptimisticMessage(sendInput("hi"), SENDER);
    const farFuture = new Date(
      optimistic.createdAt.getTime() + 60_000,
    ).toISOString() as unknown as Date;
    const confirmed = confirmedOf(optimistic, { createdAt: farFuture });
    expect(isOptimisticTwin(optimistic, confirmed)).toBe(false);
  });
});
