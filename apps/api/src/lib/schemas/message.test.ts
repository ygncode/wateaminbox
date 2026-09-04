import { describe, expect, test } from "bun:test";
import { sendMessageSchema } from "./message";

const albumMessage = {
  contactId: "00000000-0000-4000-8000-000000000001",
  content: "Holiday",
  messageType: "image" as const,
  mediaUrl: "https://media.example/holiday.jpg",
  mediaAlbum: {
    id: "3EB0000102030405FAFBFF",
    index: 0,
    count: 3,
    imageCount: 2,
    videoCount: 1,
  },
};

describe("send message media album validation", () => {
  test("accepts a bounded WhatsApp album child", () => {
    expect(sendMessageSchema.safeParse(albumMessage).success).toBe(true);
  });

  test("rejects an out-of-range child index", () => {
    expect(
      sendMessageSchema.safeParse({
        ...albumMessage,
        mediaAlbum: { ...albumMessage.mediaAlbum, index: 3 },
      }).success,
    ).toBe(false);
  });

  test("rejects inconsistent image and video counts", () => {
    expect(
      sendMessageSchema.safeParse({
        ...albumMessage,
        mediaAlbum: { ...albumMessage.mediaAlbum, imageCount: 3 },
      }).success,
    ).toBe(false);
  });
});
