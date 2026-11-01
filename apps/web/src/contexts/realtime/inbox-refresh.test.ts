import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { hasPendingInboxRefresh, scheduleInboxRefresh } from "./inbox-refresh";

const clients: QueryClient[] = [];
const prefix = ["chats", "workspace-a", "list"] as const;
function setup(
  fetcher: (signal: AbortSignal) => Promise<number>,
  key: readonly string[] = prefix,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const observer = new QueryObserver(client, {
    queryKey: [...key, "fixture"],
    initialData: 0,
    staleTime: Infinity,
    queryFn: ({ signal }) => fetcher(signal),
  });
  observer.subscribe(() => {});
  return { client, observer };
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});
const settle = () => Bun.sleep(320);

test("marks stale immediately and coalesces a burst into one active refresh", async () => {
  let calls = 0;
  const { client, observer } = setup(async () => ++calls);
  for (let i = 0; i < 10; i++) scheduleInboxRefresh(client, [prefix]);
  expect(client.getQueryState([...prefix, "fixture"])?.isInvalidated).toBe(
    true,
  );
  expect(hasPendingInboxRefresh(client)).toBe(true);
  expect(calls).toBe(0);
  await settle();
  expect(calls).toBe(1);
  expect(observer.getCurrentResult().data).toBe(1);
  expect(hasPendingInboxRefresh(client)).toBe(false);
});

test("signals during a refresh get one follow-up without cancelling the request", async () => {
  let calls = 0;
  let release!: (value: number) => void;
  let firstSignal: AbortSignal | undefined;
  const { client } = setup(async (signal) => {
    calls++;
    if (calls === 1) {
      firstSignal = signal;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    }
    return calls;
  });
  scheduleInboxRefresh(client, [prefix]);
  await settle();
  expect(calls).toBe(1);
  for (let i = 0; i < 5; i++) scheduleInboxRefresh(client, [prefix]);
  expect(firstSignal?.aborted).toBe(false);
  release(1);
  await settle();
  expect(calls).toBe(2);
  expect(firstSignal?.aborted).toBe(false);
  expect(hasPendingInboxRefresh(client)).toBe(false);
});

test("waits for a concurrent page fetch then revalidates rather than losing the event", async () => {
  let calls = 0;
  let release!: (value: number) => void;
  const { client, observer } = setup(async () => {
    calls++;
    return calls === 1
      ? new Promise<number>((resolve) => {
          release = resolve;
        })
      : calls;
  });
  const inFlight = observer.refetch();
  scheduleInboxRefresh(client, [prefix]);
  await settle();
  expect(calls).toBe(1);
  release(1);
  await inFlight;
  await settle();
  expect(calls).toBe(2);
  expect(hasPendingInboxRefresh(client)).toBe(false);
});

test("continuous messages cannot postpone the refresh indefinitely", async () => {
  let calls = 0;
  const { client } = setup(async () => ++calls);
  for (let i = 0; i < 15; i++) {
    scheduleInboxRefresh(client, [prefix]);
    await Bun.sleep(80);
  }
  expect(calls).toBeGreaterThanOrEqual(1);
  await settle();
  expect(hasPendingInboxRefresh(client)).toBe(false);
});

test("captured workspace keys do not refresh another workspace after switching", async () => {
  let oldCalls = 0;
  const { client } = setup(async () => ++oldCalls);
  let otherCalls = 0;
  const other = new QueryObserver(client, {
    queryKey: ["chats", "workspace-b", "list", "fixture"],
    initialData: 0,
    staleTime: Infinity,
    queryFn: async () => ++otherCalls,
  });
  other.subscribe(() => {});
  scheduleInboxRefresh(client, [prefix]);
  client.removeQueries({ queryKey: prefix });
  await settle();
  expect(oldCalls).toBe(0);
  expect(otherCalls).toBe(0);
  expect(hasPendingInboxRefresh(client)).toBe(false);
});
