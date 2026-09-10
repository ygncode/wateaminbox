import { describe, expect, test } from "bun:test";
import { mediaAlbum } from "./transport";

const album = {
  id: "album-1",
  index: 0,
  count: 2,
  imageCount: 2,
  videoCount: 0,
};

describe("mediaAlbum", () => {
  test("carries a complete album through to the worker", () => {
    expect(mediaAlbum(album)).toEqual(album);
  });

  test("drops an album missing any field the worker positions tiles from", () => {
    // A partial album is worse than none: it would place a photo at a tile
    // index that does not exist. The payload is JSON that has round-tripped
    // through the database, so a missing field is reachable.
    for (const field of Object.keys(album)) {
      const partial = { ...album } as Record<string, unknown>;
      delete partial[field];
      expect(mediaAlbum(partial)).toBeUndefined();
    }
  });

  test("rejects counts that are not whole, non-negative numbers", () => {
    expect(mediaAlbum({ ...album, index: -1 })).toBeUndefined();
    expect(mediaAlbum({ ...album, count: 1.5 })).toBeUndefined();
    expect(mediaAlbum({ ...album, imageCount: "2" })).toBeUndefined();
  });

  test("treats a message with no album as having none", () => {
    expect(mediaAlbum(undefined)).toBeUndefined();
    expect(mediaAlbum(null)).toBeUndefined();
    expect(mediaAlbum("album-1")).toBeUndefined();
  });
});
