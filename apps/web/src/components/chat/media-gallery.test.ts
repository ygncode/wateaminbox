import { describe, expect, test } from "bun:test";
import {
  appendGalleryFiles,
  createWhatsAppAlbumId,
  MAX_MEDIA_GALLERY_ITEMS,
} from "./media-gallery";

function file(name: string, type = "image/jpeg", lastModified = 1): File {
  return new File([name], name, { type, lastModified });
}

describe("media gallery selection", () => {
  test("keeps image and video order while removing duplicates", () => {
    const image = file("one.jpg");
    const video = file("two.mp4", "video/mp4");
    const result = appendGalleryFiles([], [image, video, image]);

    expect(result.attachments.map((item) => item.file.name)).toEqual([
      "one.jpg",
      "two.mp4",
    ]);
    expect(result.omitted).toBe(0);
  });

  test("rejects unsupported files and caps a gallery at thirty items", () => {
    const selected = Array.from(
      { length: MAX_MEDIA_GALLERY_ITEMS + 2 },
      (_, index) => file(`${index}.jpg`, "image/jpeg", index),
    );
    selected.push(file("notes.txt", "text/plain"));

    const result = appendGalleryFiles([], selected);

    expect(result.attachments).toHaveLength(MAX_MEDIA_GALLERY_ITEMS);
    expect(result.omitted).toBe(3);
  });

  test("creates a WhatsApp-compatible deterministic album parent ID", () => {
    expect(
      createWhatsAppAlbumId(new Uint8Array([0, 1, 2, 3, 4, 5, 250, 251, 255])),
    ).toBe("3EB0000102030405FAFBFF");
  });
});
