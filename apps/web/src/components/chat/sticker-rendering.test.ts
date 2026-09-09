import { describe, expect, test } from "bun:test";

/**
 * How a sticker's stored media type decides which element draws it.
 *
 * Telegram ships three encodings behind one message type. Picking wrongly is
 * silent: a .tgs handed to an <img> renders as a broken image, which is what
 * every animated sticker did before this.
 */
function stickerRenderer(
  mimeType: string | undefined,
): "video" | "image" | "lottie" {
  const type = mimeType ?? "";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  return "lottie";
}

describe("sticker rendering", () => {
  test("static WebP stickers draw as images", () => {
    expect(stickerRenderer("image/webp")).toBe("image");
    expect(stickerRenderer("image/jpeg")).toBe("image");
  });

  test("video stickers draw as video, not an image", () => {
    expect(stickerRenderer("video/webm")).toBe("video");
  });

  test("a gzipped Lottie payload goes to the player, never to an <img>", () => {
    expect(stickerRenderer("application/gzip")).toBe("lottie");
    // Storage may fall back to an opaque type; that is still a .tgs.
    expect(stickerRenderer("application/octet-stream")).toBe("lottie");
    expect(stickerRenderer(undefined)).toBe("lottie");
  });
});
