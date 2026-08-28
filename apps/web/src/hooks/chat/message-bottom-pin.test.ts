import { describe, expect, test } from "bun:test";
import { Virtualizer } from "@tanstack/react-virtual";
import { createBottomPin } from "./message-bottom-pin";
import { MESSAGE_LIST_END_ANCHOR } from "./message-list-end-anchor";

/**
 * Regression tests for the first-refresh "thread parks above the newest
 * message" bug that survived the anchorTo:"end" fix.
 *
 * The harness models what the end-anchor tests in
 * message-list-end-anchor.test.ts deliberately simplify away: the DOM lags
 * the virtualizer. React (with useFlushSync:false) commits the grown inner
 * box asynchronously, so a compensating scrollTop write issued inside
 * resizeItem is clamped against the *old* scrollHeight. The clamped offset
 * feeds back through the scroll event; once the virtual distance from the
 * end exceeds scrollEndThreshold the library stops compensating and each
 * further media decode adds its full height to the deficit.
 *
 * Concretely: commits happen as explicit steps, scrollTo writes clamp
 * against the currently committed DOM (including real overflow from a grown
 * absolutely-positioned row), and scroll events are delivered on the next
 * frame — the lifecycle of a refresh of a media-heavy chat.
 */

const VIEWPORT_HEIGHT = 600;
const ESTIMATED_ROW_HEIGHT = 80;
const TEXT_ROW_HEIGHT = 40;
const IMAGE_PLACEHOLDER_HEIGHT = 240; // 320x240 attribute box before decode
const IMAGE_DECODED_HEIGHT = 690; // portrait image at bubble width
const ROW_COUNT = 30;
const LAST_ROW = ROW_COUNT - 1;
// Two images near the bottom with a text message after each, like the
// reported conversation (menu photo, screenshot, then "Hello kha").
const IMAGE_ROWS = [26, 28];

function createFirstRefreshHarness({ withPin }: { withPin: boolean }) {
  const rafQueue: Array<() => void> = [];
  const fakeWindow = {
    requestAnimationFrame: (cb: () => void) => rafQueue.push(cb),
    cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
  };

  // Intrinsic DOM height of each row's content right now. Media rows sit at
  // their attribute-box placeholder height until "decoded".
  const domHeights = Array.from({ length: ROW_COUNT }, (_, i): number =>
    IMAGE_ROWS.includes(i) ? IMAGE_PLACEHOLDER_HEIGHT : TEXT_ROW_HEIGHT,
  );

  // What React last committed: inner box height and row translateY offsets.
  let committedTotal = 0;
  let committedStarts = new Map<number, number>();
  const measured = new Set<number>();

  let emitOffset: ((offset: number, isScrolling: boolean) => void) | null =
    null;
  const pendingScrollEvents: number[] = [];

  const scrollElement = {
    ownerDocument: { defaultView: fakeWindow },
    scrollTop: 0,
    get clientHeight() {
      return VIEWPORT_HEIGHT;
    },
    // Committed layout plus real overflow: a grown absolutely-positioned row
    // extends the scrollable area immediately, but rows below it and the
    // inner box only move at the next commit.
    get scrollHeight() {
      let bottom = committedTotal;
      for (const [index, start] of committedStarts) {
        bottom = Math.max(bottom, start + domHeights[index]);
      }
      return Math.max(bottom, VIEWPORT_HEIGHT);
    },
    scrollTo({ top }: { top: number }) {
      applyScrollTop(top);
    },
  };

  const applyScrollTop = (top: number) => {
    const max = scrollElement.scrollHeight - VIEWPORT_HEIGHT;
    const next = Math.max(0, Math.min(top, max));
    if (next !== scrollElement.scrollTop) {
      scrollElement.scrollTop = next;
      pendingScrollEvents.push(next);
    }
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
    ...MESSAGE_LIST_END_ANCHOR,
  });

  const bottomPin = createBottomPin();
  // What useMessageVirtualization's reconcileBottomPin does on each scroll
  // event and after each commit that changed measured sizes.
  const observePin = () => {
    if (!withPin) return;
    const decision = bottomPin.observe({
      scrollTop: scrollElement.scrollTop,
      scrollHeight: scrollElement.scrollHeight,
      clientHeight: VIEWPORT_HEIGHT,
    });
    if (decision === "repin") {
      applyScrollTop(scrollElement.scrollHeight);
    }
  };

  // A React commit: the adapter re-reads virtual items and total size, the
  // DOM gets the new inner box height and row offsets, and newly mounted
  // rows measure their intrinsic height through their ref.
  const commit = () => {
    const rows = virtualizer.getVirtualItems();
    committedStarts = new Map(rows.map((row) => [row.index, row.start]));
    committedTotal = virtualizer.getTotalSize();
    for (const row of rows) {
      if (!measured.has(row.index)) {
        measured.add(row.index);
        virtualizer.resizeItem(row.index, domHeights[row.index]);
      }
    }
    observePin();
  };

  const deliverScrollEvents = () => {
    while (pendingScrollEvents.length > 0) {
      const offset = pendingScrollEvents.shift();
      if (offset === undefined) break;
      emitOffset?.(offset, false);
      observePin();
    }
  };

  const frame = () => {
    const callbacks = rafQueue.splice(0);
    callbacks.forEach((cb) => cb());
    deliverScrollEvents();
    commit();
  };

  const settle = (frames = 30) => {
    for (let i = 0; i < frames; i++) frame();
  };

  virtualizer._didMount();
  virtualizer._willUpdate();
  // First render after the messages query resolves: viewport still at the
  // top, every row at its estimated height.
  commit();

  return {
    scrollElement,
    bottomPin,
    settle,
    distanceFromBottom: () =>
      scrollElement.scrollHeight -
      scrollElement.scrollTop -
      VIEWPORT_HEIGHT,
    // The initial-anchor effect claiming the conversation.
    anchorToNewest: () => {
      if (withPin) bottomPin.intend();
      virtualizer.scrollToIndex(LAST_ROW, { align: "end", behavior: "auto" });
      settle();
    },
    // The floating scroll-down button.
    clickScrollToBottom: () => {
      if (withPin) bottomPin.intend();
      virtualizer.scrollToIndex(LAST_ROW, { align: "end", behavior: "auto" });
      settle();
    },
    // A lazily loaded image finishes decoding: the row's DOM grows now, the
    // virtualizer hears about it via ResizeObserver, React commits later.
    decodeImageAt: (index: number) => {
      domHeights[index] = IMAGE_DECODED_HEIGHT;
      virtualizer.resizeItem(index, IMAGE_DECODED_HEIGHT);
      settle();
    },
    userScrollTo: (top: number) => {
      applyScrollTop(top);
      settle(2);
    },
  };
}

describe("first refresh with large media (DOM-lag harness)", () => {
  test("without the bottom pin, decodes after the anchor strand the viewport short (the reported bug)", () => {
    const thread = createFirstRefreshHarness({ withPin: false });
    thread.anchorToNewest();
    expect(thread.distanceFromBottom()).toBe(0);

    thread.decodeImageAt(28);
    thread.decodeImageAt(26);

    // Parked far enough above the newest message that the scroll-down
    // button (>=100px) shows — the screenshotted state.
    expect(thread.distanceFromBottom()).toBeGreaterThanOrEqual(100);
  });

  test("with the bottom pin, the thread lands and stays at the true bottom through both decodes", () => {
    const thread = createFirstRefreshHarness({ withPin: true });
    thread.anchorToNewest();
    expect(thread.distanceFromBottom()).toBe(0);

    thread.decodeImageAt(28);
    expect(thread.distanceFromBottom()).toBe(0);

    thread.decodeImageAt(26);
    expect(thread.distanceFromBottom()).toBe(0);
  });

  test("scroll-down button reaches the true bottom even when an image decodes mid-jump", () => {
    const thread = createFirstRefreshHarness({ withPin: true });
    thread.anchorToNewest();
    thread.userScrollTo(200);
    expect(thread.bottomPin.isPinned()).toBe(false);

    thread.clickScrollToBottom();
    thread.decodeImageAt(26);
    thread.decodeImageAt(28);

    expect(thread.distanceFromBottom()).toBe(0);
  });

  test("a reader in history is never yanked down by a late decode", () => {
    const thread = createFirstRefreshHarness({ withPin: true });
    thread.anchorToNewest();

    thread.userScrollTo(300);
    expect(thread.bottomPin.isPinned()).toBe(false);

    thread.decodeImageAt(28);

    expect(thread.scrollElement.scrollTop).toBe(300);
  });
});

describe("createBottomPin", () => {
  const metrics = (
    scrollTop: number,
    scrollHeight: number,
    clientHeight = VIEWPORT_HEIGHT,
  ) => ({ scrollTop, scrollHeight, clientHeight });

  test("starts unpinned and stays passive away from the bottom", () => {
    const pin = createBottomPin();
    expect(pin.isPinned()).toBe(false);
    expect(pin.observe(metrics(100, 2000))).toBe("none");
    expect(pin.isPinned()).toBe(false);
  });

  test("asks to repin when content grows underneath a pinned viewport", () => {
    const pin = createBottomPin();
    pin.intend();
    // At the bottom of 1600px of content...
    expect(pin.observe(metrics(1000, 1600))).toBe("none");
    // ...then a commit grows the content while scrollTop stayed put.
    expect(pin.observe(metrics(1000, 2050))).toBe("repin");
  });

  test("asks to repin when a clamped compensation write lands short", () => {
    const pin = createBottomPin();
    pin.intend();
    expect(pin.observe(metrics(1000, 1600))).toBe("none");
    // The write moved down but was clamped 40px short of the grown bottom.
    expect(pin.observe(metrics(1410, 2050))).toBe("repin");
  });

  test("an upward scroll releases the pin and growth no longer repins", () => {
    const pin = createBottomPin();
    pin.intend();
    expect(pin.observe(metrics(1000, 1600))).toBe("none");
    expect(pin.observe(metrics(400, 1600))).toBe("none");
    expect(pin.isPinned()).toBe(false);
    expect(pin.observe(metrics(400, 2050))).toBe("none");
  });

  test("returning to the bottom by hand re-engages the pin", () => {
    const pin = createBottomPin();
    pin.observe(metrics(400, 1600));
    expect(pin.isPinned()).toBe(false);
    expect(pin.observe(metrics(1000, 1600))).toBe("none");
    expect(pin.isPinned()).toBe(true);
  });

  test("a shrink correction re-engages once the commit lands at the bottom", () => {
    const pin = createBottomPin();
    pin.intend();
    expect(pin.observe(metrics(1000, 1600))).toBe("none");
    // Rows measured smaller: the compensation moved scrollTop up before the
    // inner box shrank — looks like an upward scroll for one event...
    expect(pin.observe(metrics(950, 1600))).toBe("none");
    expect(pin.isPinned()).toBe(false);
    // ...and the following commit shows the true bottom again.
    expect(pin.observe(metrics(950, 1550))).toBe("none");
    expect(pin.isPinned()).toBe(true);
  });

  test("an unscrollable container does not seed a pin that would fight highlight navigation", () => {
    const pin = createBottomPin();
    // Empty conversation: trivially "at the bottom".
    expect(pin.observe(metrics(0, VIEWPORT_HEIGHT))).toBe("none");
    expect(pin.isPinned()).toBe(false);
    // Messages arrive for a highlight-navigation open: no yank to bottom.
    expect(pin.observe(metrics(0, 2400))).toBe("none");
  });

  test("reset forgets the previous conversation's offsets", () => {
    const pin = createBottomPin();
    pin.intend();
    pin.observe(metrics(1000, 1600));
    pin.reset();
    expect(pin.isPinned()).toBe(false);
    // A fresh conversation starting at the top is not an "upward scroll".
    expect(pin.observe(metrics(0, 2000))).toBe("none");
  });

  test("release keeps highlight navigation in charge of the viewport", () => {
    const pin = createBottomPin();
    pin.intend();
    pin.observe(metrics(1000, 1600));
    pin.release();
    expect(pin.observe(metrics(1000, 2050))).toBe("none");
  });
});
