import { expect, test } from "bun:test";
import { anchoredChatScrollTop } from "./chat-list-anchor";

const rows = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: String(start + i) }));
const height = 76;

test("evicting a leading page preserves the visible row and intra-row offset", () => {
  expect(
    anchoredChatScrollTop(
      rows(0, 500),
      rows(100, 500),
      450 * height + 12,
      height,
      true,
    ),
  ).toBe(350 * height + 12);
});
test("prepending a newer page preserves the visible row while evicting the tail", () => {
  expect(
    anchoredChatScrollTop(
      rows(100, 500),
      rows(0, 500),
      3 * height + 9,
      height,
      true,
    ),
  ).toBe(103 * height + 9);
});
test("prepending at the top of a deep window does not jump to a different chat", () => {
  expect(
    anchoredChatScrollTop(rows(100, 500), rows(0, 500), 0, height, true),
  ).toBe(100 * height);
});
test("the latest view stays at the top when a new chat arrives", () => {
  expect(
    anchoredChatScrollTop(rows(1, 100), rows(0, 100), 0, height, false),
  ).toBe(0);
});
test("reordering and deletion preserve a surviving neighbour, not the list start", () => {
  const original = rows(0, 100);
  expect(
    anchoredChatScrollTop(
      original,
      [original[99], ...original.slice(0, 99)],
      50 * height + 3,
      height,
      false,
    ),
  ).toBe(51 * height + 3);
  expect(
    anchoredChatScrollTop(
      original,
      original.filter((row) => row.id !== "50"),
      50 * height + 3,
      height,
      false,
    ),
  ).toBe(49 * height + 3);
});
test("empty/new result sets reset to a safe scroll position", () => {
  expect(anchoredChatScrollTop(rows(0, 100), [], 500, height, true)).toBe(0);
  expect(anchoredChatScrollTop([], rows(0, 100), 500, height, true)).toBe(0);
  expect(
    anchoredChatScrollTop(rows(0, 100), rows(1000, 100), 500, height, true),
  ).toBe(0);
});
