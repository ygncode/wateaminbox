import { describe, expect, test } from "bun:test";
import { sniffMediaType } from "./media-sniff.js";

const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const oleHead = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const utf16 = (value: string) => Buffer.from(value, "utf16le");

describe("sniffMediaType", () => {
  test("identifies a PDF", () => {
    expect(sniffMediaType(Buffer.from("%PDF-1.7"))).toEqual({
      extension: "pdf",
      mimeType: "application/pdf",
    });
  });

  test("separates xlsx from docx by central-directory entries", () => {
    expect(
      sniffMediaType(zipHead, Buffer.from("xl/workbook.xml"))?.extension,
    ).toBe("xlsx");
    expect(
      sniffMediaType(zipHead, Buffer.from("word/document.xml"))?.extension,
    ).toBe("docx");
    expect(
      sniffMediaType(zipHead, Buffer.from("ppt/presentation.xml"))?.extension,
    ).toBe("pptx");
  });

  test("falls back to zip when a container names nothing familiar", () => {
    expect(sniffMediaType(zipHead, Buffer.from("photos/1.jpg"))).toEqual({
      extension: "zip",
      mimeType: "application/zip",
    });
  });

  test("identifies legacy Office files by their OLE stream names", () => {
    expect(
      sniffMediaType(Buffer.concat([oleHead, utf16("Workbook")]))?.extension,
    ).toBe("xls");
    expect(
      sniffMediaType(Buffer.concat([oleHead, utf16("WordDocument")]))
        ?.extension,
    ).toBe("doc");
  });

  test("declines an unrecognized compound file rather than guessing", () => {
    expect(
      sniffMediaType(Buffer.concat([oleHead, Buffer.alloc(64)])),
    ).toBeNull();
  });

  test("identifies PNG, JPEG, and WebP images by their magic bytes", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(sniffMediaType(png)).toEqual({
      extension: "png",
      mimeType: "image/png",
    });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(sniffMediaType(jpeg)).toEqual({
      extension: "jpg",
      mimeType: "image/jpeg",
    });

    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20,
    ]);
    expect(sniffMediaType(webp)).toEqual({
      extension: "webp",
      mimeType: "image/webp",
    });
  });

  test("does not misidentify a non-WebP RIFF container (WAV) as WebP", () => {
    const wav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20,
    ]);
    expect(sniffMediaType(wav)).toBeNull();
  });

  test("declines bytes it does not recognize", () => {
    expect(sniffMediaType(Buffer.from("just some text"))).toBeNull();
    expect(sniffMediaType(Buffer.alloc(0))).toBeNull();
  });
});
