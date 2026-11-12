import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const read = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

/**
 * Regression guard for the blank Chats tab.
 *
 * Switching Groups -> Chats remounts ChatList with chats already cached, so the
 * virtualized rows mount in the same commit as the scroll container. Their
 * layout effect runs before the ancestor's ref is attached; the virtualizer
 * then saw no scroll element, measured a 0x0 viewport, and rendered no rows
 * (the list stayed empty although its full height was reserved).
 *
 * The scroll element must therefore reach the rows through React state (a
 * callback ref), which re-renders them once the element exists, not only
 * through a mutable ref read during their first effect.
 */
describe("chat list scroll element", () => {
  const chatList = read("./ChatList.tsx");
  const rows = read("./VirtualizedChatRows.tsx");

  it("attaches the scroll container through a callback ref that sets state", () => {
    expect(chatList).toContain("ref={attachScrollContainer}");
    expect(chatList).toMatch(
      /const attachScrollContainer = useCallback\(\(node: HTMLDivElement \| null\) => \{\s*scrollContainerRef\.current = node;\s*setScrollElement\(node\);/,
    );
  });

  it("hands the stateful element to the virtualized rows", () => {
    expect(chatList).toContain("scrollElement={scrollElement}");
    expect(rows).toContain(
      "getScrollElement: () => scrollElement ?? scrollContainerRef.current",
    );
  });
});
