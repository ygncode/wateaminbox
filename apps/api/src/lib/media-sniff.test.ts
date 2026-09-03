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

  test("declines bytes it does not recognize", () => {
    expect(sniffMediaType(Buffer.from("just some text"))).toBeNull();
    expect(sniffMediaType(Buffer.alloc(0))).toBeNull();
  });
});
