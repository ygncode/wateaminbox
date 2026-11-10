import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  api,
  clearAuthTokens,
  setAuthToken,
  setCompanyId,
} from "../lib/api/client";
import { chatKeys } from "./useChats";
import {
  forwardContactsQueryOptions,
  prefetchForwardContacts,
} from "./useForwardContacts";

const cleanups: (() => void)[] = [];
let get: ReturnType<typeof spyOn<typeof api, "get">>;

beforeEach(() => {
  setAuthToken("test-only-token");
  setCompanyId("workspace-a");
  get = spyOn(api, "get").mockResolvedValue({ data: [] });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  get.mockRestore();
  clearAuthTokens();
});

function createClient() {
  const client = new QueryClient();
  cleanups.push(() => client.clear());
  return client;
}

function observe(
  client: QueryClient,
  options: ReturnType<typeof forwardContactsQueryOptions>,
) {
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  cleanups.push(() => {
    unsubscribe();
    observer.destroy();
  });
  return observer;
}

async function settle(client: QueryClient) {
  await client.getQueryCache().find({
    queryKey: chatKeys.lists(),
    exact: false,
  })?.promise;
}

describe("contact picker request lifecycle", () => {
  for (const cached of [false, true]) {
    test(`closed picker ignores realtime invalidations (${cached ? "warm" : "cold"} cache)`, async () => {
      const client = createClient();
      const options = forwardContactsQueryOptions("", false);
      if (cached) client.setQueryData(options.queryKey, []);
      observe(client, options);

      for (let index = 0; index < 20; index++) {
        await client.invalidateQueries(
          { queryKey: chatKeys.lists() },
          { cancelRefetch: false },
        );
      }
      expect(get).not.toHaveBeenCalled();
    });
  }

  test("opening fetches 100 contacts; closing stops refreshes; reopening reconciles invalidation", async () => {
    const client = createClient();
    const observer = observe(client, forwardContactsQueryOptions("", false));
    observer.setOptions(forwardContactsQueryOptions("", true));
    expect(get).toHaveBeenCalledTimes(1);
    await settle(client);
    expect(get).toHaveBeenCalledWith("/contacts?limit=100&includeGroups=true");

    observer.setOptions(forwardContactsQueryOptions("", false));
    await client.invalidateQueries({ queryKey: chatKeys.lists() });
    expect(get).toHaveBeenCalledTimes(1);

    observer.setOptions(forwardContactsQueryOptions("", true));
    expect(get).toHaveBeenCalledTimes(2);
    await settle(client);
  });

  test("a closed dialog does not disable another visible picker sharing its cache", async () => {
    const client = createClient();
    observe(client, forwardContactsQueryOptions("", false));
    observe(client, forwardContactsQueryOptions());
    await settle(client);
    expect(get).toHaveBeenCalledTimes(1);
    await client.invalidateQueries({ queryKey: chatKeys.lists() });
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("intentional prefetch remains usable when the dialog opens", async () => {
    const client = createClient();
    await prefetchForwardContacts(client);
    observe(client, forwardContactsQueryOptions());
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("prefetch does not adopt the mounted picker's retry policy", async () => {
    get.mockRejectedValue(new Error("synthetic request failure"));
    await prefetchForwardContacts(createClient());
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("search remains encoded and workspace switches get separate keys", async () => {
    const client = createClient();
    const first = forwardContactsQueryOptions("A & B");
    observe(client, first);
    await settle(client);
    expect(get).toHaveBeenCalledWith(
      "/contacts?limit=100&includeGroups=true&search=A+%26+B",
    );
    setCompanyId("workspace-b");
    const second = forwardContactsQueryOptions("A & B");
    expect(first.queryKey[1]).toBe("workspace-a");
    expect(second.queryKey[1]).toBe("workspace-b");
    expect(first.queryKey).not.toEqual(second.queryKey);
  });

  test("unauthenticated pickers and prefetch do not issue requests", async () => {
    clearAuthTokens();
    const client = createClient();
    observe(client, forwardContactsQueryOptions());
    await prefetchForwardContacts(client);
    expect(get).not.toHaveBeenCalled();
  });

  test("both mounted dialogs gate their picker on visibility", async () => {
    const forward = await Bun.file(
      new URL("../components/chat/ForwardMessageDialog.tsx", import.meta.url),
    ).text();
    const merge = await Bun.file(
      new URL(
        "../components/chat/contact-profile/MergeEditDialog.tsx",
        import.meta.url,
      ),
    ).text();
    expect(forward).toContain("useForwardContacts(searchQuery, open)");
    expect(merge).toContain("useForwardContacts(search, open)");
  });
});
