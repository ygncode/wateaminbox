import { afterEach, expect, mock, test } from "bun:test";
import {
  observeChatListEnd,
  shouldLoadNewerChats,
} from "./chat-list-pagination";

const original = globalThis.IntersectionObserver;
afterEach(() => {
  globalThis.IntersectionObserver = original;
});

test("loads near the footer within the sidebar and disconnects on scope changes", () => {
  let notify: IntersectionObserverCallback = () => {};
  let options: IntersectionObserverInit | undefined;
  const observe = mock(() => {});
  const disconnect = mock(() => {});
  globalThis.IntersectionObserver = class {
    constructor(
      callback: IntersectionObserverCallback,
      init?: IntersectionObserverInit,
    ) {
      notify = callback;
      options = init;
    }
    observe = observe;
    disconnect = disconnect;
  } as unknown as typeof IntersectionObserver;
  const root = {} as HTMLElement;
  const footer = {} as HTMLElement;
  const loadMore = mock(() => {});
  const cleanup = observeChatListEnd(root, footer, loadMore);
  expect(options).toEqual({ root, rootMargin: "0px 0px 380px 0px" });
  expect(observe).toHaveBeenCalledWith(footer);
  notify(
    [{ isIntersecting: false }] as IntersectionObserverEntry[],
    {} as IntersectionObserver,
  );
  expect(loadMore).not.toHaveBeenCalled();
  notify(
    [{ isIntersecting: true }] as IntersectionObserverEntry[],
    {} as IntersectionObserver,
  );
  expect(loadMore).toHaveBeenCalledTimes(1);
  cleanup();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("upward paging ignores a collapsed filtered window and downward scrolling", () => {
  const root = { scrollTop: 100, scrollHeight: 2000, clientHeight: 600 };
  expect(shouldLoadNewerChats(root, 200)).toBe(true);
  expect(shouldLoadNewerChats(root, 50)).toBe(false);
  expect(shouldLoadNewerChats({ ...root, scrollTop: 500 }, 600)).toBe(false);
  expect(
    shouldLoadNewerChats({ ...root, scrollTop: 0, scrollHeight: 600 }, 200),
  ).toBe(false);
});

test("supports browsers without IntersectionObserver via the manual load button", () => {
  globalThis.IntersectionObserver =
    undefined as unknown as typeof IntersectionObserver;
  const loadMore = mock(() => {});
  expect(() =>
    observeChatListEnd({} as HTMLElement, {} as HTMLElement, loadMore)(),
  ).not.toThrow();
  expect(loadMore).not.toHaveBeenCalled();
});
