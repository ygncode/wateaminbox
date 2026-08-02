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
const toastPayloads: unknown[] = [];

mock.module("../../lib/realtime", () => ({
  bindEvent: (eventType: string, handler: RealtimeEventHandler) => {
    handlers.set(eventType, handler);
    return () => handlers.delete(eventType);
  },
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
});
