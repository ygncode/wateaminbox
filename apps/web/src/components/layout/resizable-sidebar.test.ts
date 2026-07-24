import { describe, expect, test } from "bun:test";
import {
  clampSidebarWidth,
  getSidebarMaxWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./resizable-sidebar";

describe("resizable chat sidebar", () => {
  test("clamps the sidebar to its minimum width", () => {
    expect(clampSidebarWidth(120, 1440)).toBe(SIDEBAR_MIN_WIDTH);
  });

  test("uses at most half of a smaller desktop viewport", () => {
    expect(getSidebarMaxWidth(1024)).toBe(512);
    expect(clampSidebarWidth(700, 1024)).toBe(512);
  });

  test("caps expansion on wide displays", () => {
    expect(getSidebarMaxWidth(1920)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(900, 1920)).toBe(SIDEBAR_MAX_WIDTH);
  });

  test("keeps widths inside the allowed range unchanged", () => {
    expect(clampSidebarWidth(424, 1440)).toBe(424);
  });
});
