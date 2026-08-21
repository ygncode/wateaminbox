import { beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../hooks/query-keys";
import { chatKeys } from "../../hooks/useChats";
import { setCompanyId } from "../../lib/api/client";
import type {
  RealtimeEventData,
  RealtimeEventHandler,
} from "../../lib/realtime";

const handlers = new Map<string, RealtimeEventHandler>();
/** Which channel each event was bound to, so the split stays asserted here. */
const boundChannel = new Map<string, "company" | "user">();
const toastPayloads: unknown[] = [];

function record(channel: "company" | "user") {
  return (eventType: string, handler: RealtimeEventHandler) => {
    handlers.set(eventType, handler);
    boundChannel.set(eventType, channel);
    return () => handlers.delete(eventType);
  };
}

mock.module("../../lib/realtime", () => ({
  bindEvent: record("company"),
  bindUserEvent: record("user"),
}));

mock.module("../../lib/toast-notifications", () => ({
  showRealtimeToast: (payload: unknown) => {
    toastPayloads.push(payload);
    return true;
  },
}));

let registerRealtimeEventHandlers: typeof import("./event-handlers").registerRealtimeEventHandlers;

beforeAll(async () => {
  ({ registerRealtimeEventHandlers } = await import("./event-handlers"));
});

function register(queryClient: QueryClient): () => void {
  handlers.clear();
  boundChannel.clear();
  toastPayloads.length = 0;
  const cleanups = registerRealtimeEventHandlers({
    queryClient,
    companyId: "company-a",
    setSyncingConnections: () => {},
    addTypingIndicator: () => {},
    removeTypingIndicator: () => {},
    setTypingTimeout: () => {},
    clearTypingTimeout: () => {},
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}

function emit(eventType: string, payload: unknown): void {
  const handler = handlers.get(eventType);
  if (!handler)
    throw new Error(`No realtime handler registered for ${eventType}`);
  handler({
    payload,
    timestamp: new Date().toISOString(),
  } as RealtimeEventData);
}

describe("realtime event handlers", () => {
  test("auto_reopened invalidates list, analytics, and lifecycle state without a toast", () => {
    setCompanyId("company-a");
    const client = new QueryClient();
    const chatKey = chatKeys.list({});
    const groupKey = queryKeys.groups.list({});
    const analyticsKey = queryKeys.analytics.responseTimeStats("company-a");
    const lifecycleKey = queryKeys.conversations.detail("contact-1");
    client.setQueryData(chatKey, []);
    client.setQueryData(groupKey, { data: [] });
    client.setQueryData(analyticsKey, {});
    client.setQueryData(lifecycleKey, {});
    const cleanup = register(client);

    emit("conversation:updated", {
      event: "auto_reopened",
      contactId: "contact-1",
      caseId: "case-1",
    });

    expect(client.getQueryState(chatKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(groupKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(analyticsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(lifecycleKey)?.isInvalidated).toBe(true);
    expect(toastPayloads).toHaveLength(0);
    cleanup();
  });

  test("background-operation notification toasts remain enabled", () => {
    const cleanup = register(new QueryClient());

    emit("notification:toast", {
      type: "success",
      title: "Broadcast finished",
      message: '"August update" finished: 20 sent',
    });

    expect(toastPayloads).toHaveLength(1);
    expect(toastPayloads[0]).toMatchObject({
      type: "success",
      title: "Broadcast finished",
    });
    cleanup();
  });

  test("profile picture updates invalidate an open contact detail", () => {
    setCompanyId("company-a");
    const client = new QueryClient();
    const detailKey = queryKeys.contacts.detail("contact-1");
    client.setQueryData(detailKey, { profilePictureUrl: null });
    const cleanup = register(client);

    emit("contact:profile_picture", {
      jid: "15551234567@s.whatsapp.net",
      mediaAvailable: true,
    });

    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    cleanup();
  });
});

/**
 * The server only fans conversation events out to the users authorized to read
 * that conversation, and it addresses them to that user's own channel. A
 * handler bound to the shared company channel would simply never fire.
 */
describe("conversation events are bound to the user channel", () => {
  test("every conversation-scoped event listens on the user channel", () => {
    const cleanup = register(new QueryClient());
    try {
      for (const eventType of [
        "message:new",
        "message:status",
        "message:failed",
        "message:deleted",
        "message:reaction",
        "scheduled_message:updated",
        "typing:start",
        "typing:stop",
        "conversation:read",
        "conversation:updated",
        "contact:updated",
        "contact:profile_picture",
        "presence:online",
        "presence:offline",
        "media:downloaded",
        "media:download_failed",
      ]) {
        expect([eventType, boundChannel.get(eventType)]).toEqual([
          eventType,
          "user",
        ]);
      }
    } finally {
      cleanup();
    }
  });

  test("workspace control events stay on the company channel", () => {
    const cleanup = register(new QueryClient());
    try {
      for (const eventType of ["notification:toast", "bulk_job:updated"]) {
        expect([eventType, boundChannel.get(eventType)]).toEqual([
          eventType,
          "company",
        ]);
      }
    } finally {
      cleanup();
    }
  });
});
