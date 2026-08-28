import { describe, expect, test } from "bun:test";
import { Virtualizer } from "@tanstack/react-virtual";
import { MESSAGE_LIST_END_ANCHOR } from "./message-list-end-anchor";

/**
 * Regression tests for the "scroll-down button doesn't reach the bottom"
 * bug. Image/video rows are lazily loaded, so their row height grows only
 * after the thread has already scrolled to the newest message. These tests
 * drive the real virtualizer (the same instance useMessageVirtualization
 * creates) with a fake scroll element and verify that a late media decode
 * keeps the viewport pinned to the bottom instead of leaving it short.
 */

const VIEWPORT_HEIGHT = 600;
const ESTIMATED_ROW_HEIGHT = 80;
const ROW_COUNT = 30;
const LAST_ROW = ROW_COUNT - 1;

function createThreadHarness({ endAnchor = true }: { endAnchor?: boolean } = {}) {
  const rafQueue: Array<() => void> = [];
  const fakeWindow = {
    requestAnimationFrame: (cb: () => void) => rafQueue.push(cb),
    cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
  };

  let emitOffset: ((offset: number, isScrolling: boolean) => void) | null =
    null;

  const scrollElement = {
    ownerDocument: { defaultView: fakeWindow },
    scrollTop: 0,
    // The message list's inner box is sized to the virtualizer's total size,
    // so the scrollable height tracks it exactly.
    get scrollHeight() {
      return Math.max(virtualizer.getTotalSize(), VIEWPORT_HEIGHT);
    },
    get clientHeight() {
      return VIEWPORT_HEIGHT;
    },
  };

  const applyScrollTop = (top: number) => {
    const max = scrollElement.scrollHeight - VIEWPORT_HEIGHT;
    scrollElement.scrollTop = Math.max(0, Math.min(top, max));
    emitOffset?.(scrollElement.scrollTop, false);
  };

  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: ROW_COUNT,
    getScrollElement: () => scrollElement as unknown as HTMLDivElement,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => `message-${index}`,
    observeElementRect: (_instance, cb) => {
      cb({ width: 800, height: VIEWPORT_HEIGHT });
    },
    observeElementOffset: (_instance, cb) => {
      emitOffset = cb;
      cb(scrollElement.scrollTop, false);
    },
    scrollToFn: (offset, { adjustments }) => {
      applyScrollTop(offset + (adjustments ?? 0));
    },
    ...(endAnchor ? MESSAGE_LIST_END_ANCHOR : {}),
  });

  virtualizer._didMount();
  virtualizer._willUpdate();

  // Mirrors the React adapter reading virtual items + total size on render.
  const render = () => {
    virtualizer.getVirtualItems();
    virtualizer.getTotalSize();
  };
  render();

  // Runs the virtualizer's scroll reconciliation until it settles.
  const flushFrames = () => {
    for (let i = 0; i < 50 && rafQueue.length > 0; i++) {
      rafQueue.shift()?.();
      render();
    }
  };

  return {
    scrollElement,
    distanceFromBottom: () =>
      scrollElement.scrollHeight - scrollElement.scrollTop - VIEWPORT_HEIGHT,
    scrollTo: (top: number) => {
      applyScrollTop(top);
      render();
    },
    // What useMessageVirtualization's scrollToBottom does on button click.
    clickScrollToBottom: () => {
      virtualizer.scrollToIndex(LAST_ROW, { align: "end", behavior: "auto" });
      render();
      flushFrames();
    },
    // A lazily loaded image finishes decoding and its row is remeasured.
    decodeImageAt: (index: number, rowHeight: number) => {
      virtualizer.resizeItem(index, rowHeight);
      render();
      flushFrames();
    },
  };
}

describe("MESSAGE_LIST_END_ANCHOR", () => {
  test("scroll-to-bottom lands at the bottom", () => {
    const thread = createThreadHarness();
    thread.scrollTo(300);

    thread.clickScrollToBottom();

    expect(thread.distanceFromBottom()).toBe(0);
  });

  test("stays at the bottom when the newest image row decodes taller after the scroll settled", () => {
    const thread = createThreadHarness();
    thread.clickScrollToBottom();

    // A 320x240 placeholder decodes into a portrait image: the row grows.
    thread.decodeImageAt(LAST_ROW, ESTIMATED_ROW_HEIGHT + 300);

    expect(thread.distanceFromBottom()).toBe(0);
  });

  test("stays at the bottom when an image above the viewport decodes taller", () => {
    const thread = createThreadHarness();
    thread.clickScrollToBottom();

    thread.decodeImageAt(2, ESTIMATED_ROW_HEIGHT + 250);

    expect(thread.distanceFromBottom()).toBe(0);
  });

  test("stays at the bottom through several images decoding in sequence", () => {
    const thread = createThreadHarness();
    thread.clickScrollToBottom();

    thread.decodeImageAt(LAST_ROW, ESTIMATED_ROW_HEIGHT + 300);
    thread.decodeImageAt(LAST_ROW - 1, ESTIMATED_ROW_HEIGHT + 180);
    thread.decodeImageAt(LAST_ROW - 3, ESTIMATED_ROW_HEIGHT + 240);

    expect(thread.distanceFromBottom()).toBe(0);
  });

  test("does not move the viewport when an image decodes while reading older messages", () => {
    const thread = createThreadHarness();
    thread.scrollTo(400);

    thread.decodeImageAt(LAST_ROW, ESTIMATED_ROW_HEIGHT + 300);

    expect(thread.scrollElement.scrollTop).toBe(400);
  });

  test("without end anchoring a late image decode strands the viewport short of the bottom (the reported bug)", () => {
    const thread = createThreadHarness({ endAnchor: false });
    thread.clickScrollToBottom();

    thread.decodeImageAt(LAST_ROW, ESTIMATED_ROW_HEIGHT + 300);

    // Documents why MESSAGE_LIST_END_ANCHOR exists: the default start anchor
    // leaves the thread parked above the newest message.
    expect(thread.distanceFromBottom()).toBe(300);
  });
});
