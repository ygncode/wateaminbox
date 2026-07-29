import { describe, expect, test } from "bun:test";
import { getVisibleRowRange } from "./server-data-table";

describe("getVisibleRowRange", () => {
  test("returns a one-based range for a populated server page", () => {
    expect(
      getVisibleRowRange(
        47,
        {
          pageIndex: 1,
          pageSize: 20,
        },
        20,
      ),
    ).toEqual({ start: 21, end: 40 });
  });

  test("caps the final row and handles an empty result", () => {
    expect(
      getVisibleRowRange(
        47,
        {
          pageIndex: 2,
          pageSize: 20,
        },
        7,
      ),
    ).toEqual({ start: 41, end: 47 });
    expect(getVisibleRowRange(0, { pageIndex: 0, pageSize: 20 }, 0)).toEqual({
      start: 0,
      end: 0,
    });
  });
});
